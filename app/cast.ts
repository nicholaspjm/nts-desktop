import { Bonjour, type Service } from "bonjour-service"
import { type CastChannel, Client } from "castv2"

/**
 * Chromecast support.
 *
 * Electron cannot use the Cast browser API. Chromium's Media Router lives in
 * the Chrome browser layer, which Electron replaces, so `chrome.cast` never
 * exists and the Presentation API is inert; Electron's own request for it was
 * closed as not planned. The only route is speaking the CASTV2 wire protocol
 * from the main process, which is what this does.
 *
 * The consequence that matters for audio quality: a Cast device is not sent
 * audio. It is handed a URL and fetches the stream itself, so the original
 * 256kbps stream reaches it untouched, with no transcode, no resampling, and no
 * dependence on this machine once playback has started.
 */

// Google's stock player. Using it avoids registering and hosting a custom
// receiver app, which would need a developer registration and a hosted page.
const DEFAULT_RECEIVER = "CC1AD845"

const CAST_PORT = 8009
const NS_CONNECTION = "urn:x-cast:com.google.cast.tp.connection"
const NS_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat"
const NS_RECEIVER = "urn:x-cast:com.google.cast.receiver"
const NS_MEDIA = "urn:x-cast:com.google.cast.media"

// The device drops a sender that stops pinging.
const HEARTBEAT = 5_000

// Status is pushed when it changes, but a stall can produce no event at all,
// which is exactly the failure this app exists to survive. So also ask.
const STATUS_POLL = 5_000

// Long enough not to trip on ordinary rebuffering, short enough to repair a
// real stall before a listener gives up on it.
const STALL_TIMEOUT = 20_000

const BACKOFF_MIN = 2_000
const BACKOFF_MAX = 60_000

export type CastDevice = {
	id: string
	name: string
	host: string
	port: number
}

export type CastMedia = {
	url: string
	contentType: string
	title: string
	subtitle?: string
	image?: string
	// HLS carrying MP3 segments rather than the more usual AAC. The receiver
	// cannot always infer this, so it is stated.
	hlsSegmentFormat?: "mp3" | "aac"
}

export type CastStatus =
	| "idle"
	| "connecting"
	| "playing"
	| "buffering"
	| "reconnecting"
	| "failed"

export type CastState = {
	status: CastStatus
	device: CastDevice | null
	error?: string
}

/**
 * Finds Cast devices on the local network over mDNS.
 *
 * Deliberately bonjour-service rather than the `mdns` package: that one needs
 * native compilation, which would mean per-platform rebuilds and would collide
 * with the signed and notarised macOS build. This is pure JavaScript.
 */
export class CastDiscovery {
	private bonjour: Bonjour | null = null
	private browser: { stop: () => void } | null = null
	private devices = new Map<string, CastDevice>()

	constructor(private onChange: (devices: CastDevice[]) => void) {}

	start(): void {
		if (this.bonjour) {
			return
		}

		try {
			this.bonjour = new Bonjour()
			this.browser = this.bonjour.find({ type: "googlecast" }, (service) => {
				const device = toDevice(service)
				if (!device || this.devices.has(device.id)) {
					return
				}
				this.devices.set(device.id, device)
				this.onChange(this.list())
			})
		} catch (err) {
			// A firewall or an unusual network stack can refuse the multicast
			// socket. That costs casting, not the app, so it must not throw.
			console.warn("cast discovery unavailable:", err)
			this.bonjour = null
		}
	}

	stop(): void {
		this.browser?.stop()
		this.browser = null
		this.bonjour?.destroy()
		this.bonjour = null
	}

	/** Forgets what was found and looks again, for a manual refresh. */
	rescan(): void {
		this.devices.clear()
		this.onChange([])
		this.stop()
		this.start()
	}

	list(): CastDevice[] {
		return [...this.devices.values()].sort((a, b) => a.name.localeCompare(b.name))
	}
}

function toDevice(service: Service): CastDevice | null {
	// IPv4 only: the TLS connection below is simpler for it, and every Cast
	// device advertises one.
	const host = (service.addresses ?? []).find(
		(a) => a.includes(".") && !a.includes(":"),
	)
	if (!host) {
		return null
	}

	const txt = (service.txt ?? {}) as Record<string, string>
	return {
		// The device's own id survives renames and address changes.
		id: txt.id || `${host}:${service.port}`,
		name: txt.fn || service.name || host,
		host,
		port: service.port || CAST_PORT,
	}
}

/**
 * One connection to one device, with a watchdog over it.
 *
 * The watchdog mirrors the one guarding local playback: rather than trusting
 * the device to report a problem, it watches whether playback is actually
 * advancing, and reloads when it is not.
 */
export class CastSession {
	private client: Client | null = null
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null
	private pollTimer: ReturnType<typeof setInterval> | null = null
	private retryTimer: ReturnType<typeof setTimeout> | null = null

	private media: CastChannel | null = null
	private transportId: string | null = null
	private sessionId: string | null = null
	private requestId = 1

	private lastPosition = -1
	private progressedAt = 0
	private attempts = 0
	private closed = false

	private state: CastState

	constructor(
		private device: CastDevice,
		private content: CastMedia,
		private onState: (state: CastState) => void,
	) {
		this.state = { status: "connecting", device }
	}

	private report(status: CastStatus, error?: string): void {
		if (this.closed) {
			return
		}
		if (this.state.status === status && this.state.error === error) {
			return
		}
		this.state = { status, device: this.device, error }
		this.onState(this.state)
	}

	private nextId(): number {
		this.requestId += 1
		return this.requestId
	}

	start(): void {
		this.closed = false
		this.report("connecting")

		const client = new Client()
		this.client = client

		client.on("error", (err: Error) => {
			this.report("reconnecting", err.message)
			this.scheduleRetry(() => {
				this.teardown()
				this.start()
			})
		})

		client.connect({ host: this.device.host, port: this.device.port }, () => {
			const connection = this.channel("receiver-0", NS_CONNECTION)
			const heartbeat = this.channel("receiver-0", NS_HEARTBEAT)
			const receiver = this.channel("receiver-0", NS_RECEIVER)

			connection.send({ type: "CONNECT" })

			this.heartbeatTimer = setInterval(() => {
				try {
					heartbeat.send({ type: "PING" })
				} catch {
					// The socket died between check and write; the error handler
					// registered above deals with it.
				}
			}, HEARTBEAT)

			receiver.on("message", (data) => {
				if (data?.type !== "RECEIVER_STATUS") {
					return
				}
				const status = data.status as
					| {
							applications?: {
								appId?: string
								transportId?: string
								sessionId?: string
							}[]
					  }
					| undefined
				const running = (status?.applications ?? []).find(
					(a) => a.appId === DEFAULT_RECEIVER,
				)
				if (
					running?.transportId &&
					running.sessionId &&
					running.transportId !== this.transportId
				) {
					this.attachMedia(running.transportId, running.sessionId)
				}
			})

			receiver.send({
				type: "LAUNCH",
				appId: DEFAULT_RECEIVER,
				requestId: this.nextId(),
			})
		})
	}

	private channel(destination: string, namespace: string): CastChannel {
		if (!this.client) {
			throw new Error("cast client is not connected")
		}
		return this.client.createChannel("sender-0", destination, namespace, "JSON")
	}

	private attachMedia(transportId: string, sessionId: string): void {
		this.transportId = transportId
		this.sessionId = sessionId

		const connection = this.channel(transportId, NS_CONNECTION)
		connection.send({ type: "CONNECT" })

		const media = this.channel(transportId, NS_MEDIA)
		this.media = media
		media.on("message", (data) => this.handleStatus(data))

		this.progressedAt = Date.now()
		this.lastPosition = -1
		this.load()

		this.pollTimer = setInterval(() => {
			try {
				media.send({ type: "GET_STATUS", requestId: this.nextId() })
			} catch {
				// Covered by the client error handler.
			}
			this.checkForStall()
		}, STATUS_POLL)
	}

	private load(): void {
		if (!this.media || !this.sessionId) {
			return
		}

		this.media.send({
			type: "LOAD",
			requestId: this.nextId(),
			sessionId: this.sessionId,
			autoplay: true,
			currentTime: 0,
			media: {
				contentId: this.content.url,
				contentType: this.content.contentType,
				// Radio has no end and cannot be sought.
				streamType: "LIVE",
				...(this.content.hlsSegmentFormat
					? { hlsSegmentFormat: this.content.hlsSegmentFormat }
					: {}),
				metadata: {
					type: 0,
					metadataType: 0,
					title: this.content.title,
					...(this.content.subtitle ? { subtitle: this.content.subtitle } : {}),
					...(this.content.image ? { images: [{ url: this.content.image }] } : {}),
				},
			},
		})
	}

	private handleStatus(data: Record<string, unknown>): void {
		if (data?.type === "LOAD_FAILED" || data?.type === "LOAD_CANCELLED") {
			// Retrying a stream the device has rejected outright will not help,
			// and would hide the reason behind an endless reconnect.
			this.report("failed", "the device would not play this stream")
			return
		}

		if (data?.type !== "MEDIA_STATUS") {
			return
		}

		const status = (data.status as Record<string, unknown>[] | undefined)?.[0]
		if (!status) {
			return
		}

		const position = status.currentTime
		if (typeof position === "number" && position !== this.lastPosition) {
			this.lastPosition = position
			this.progressedAt = Date.now()
			this.attempts = 0
		}

		switch (status.playerState) {
			case "PLAYING":
				this.report("playing")
				break
			case "BUFFERING":
				this.report("buffering")
				break
			case "IDLE": {
				// A live stream should never finish. If the device says it has, the
				// source went away, whatever the device chooses to call it.
				const reason = status.idleReason
				if (typeof reason === "string" && reason !== "CANCELLED") {
					this.report("reconnecting", `device went idle: ${reason}`)
					this.scheduleRetry(() => this.reload())
				}
				break
			}
			default:
				break
		}
	}

	/**
	 * The failure a device does not report: nominally playing, but the position
	 * has stopped moving. Local playback has the same blind spot and it is
	 * caught the same way.
	 */
	private checkForStall(): void {
		if (this.closed || this.progressedAt === 0) {
			return
		}
		if (Date.now() - this.progressedAt > STALL_TIMEOUT) {
			this.report("reconnecting", "playback stopped advancing")
			this.scheduleRetry(() => this.reload())
		}
	}

	private reload(): void {
		this.progressedAt = Date.now()
		this.lastPosition = -1
		this.load()
	}

	private scheduleRetry(action: () => void): void {
		// Never stack attempts: one in flight at a time.
		if (this.closed || this.retryTimer !== null) {
			return
		}

		const wait = Math.min(BACKOFF_MIN * 2 ** this.attempts, BACKOFF_MAX)
		this.attempts += 1

		this.retryTimer = setTimeout(() => {
			this.retryTimer = null
			if (!this.closed) {
				action()
			}
		}, wait)
	}

	/** Tells the device to stop, then disconnects. */
	stop(): void {
		this.closed = true
		try {
			this.media?.send({ type: "STOP", requestId: this.nextId() })
		} catch {
			// Already gone.
		}
		this.teardown()
		this.state = { status: "idle", device: null }
		this.onState(this.state)
	}

	private teardown(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = null
		}
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
		if (this.retryTimer) {
			clearTimeout(this.retryTimer)
			this.retryTimer = null
		}
		try {
			this.client?.close()
		} catch {
			// Closing an already dead socket is not worth reporting.
		}
		this.client = null
		this.media = null
		this.transportId = null
		this.sessionId = null
	}
}
