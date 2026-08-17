import { useCallback, useEffect, useRef } from "react"

export type PlayerStatus =
	| "idle"
	| "connecting"
	| "playing"
	| "reconnecting"
	| "failed"

type Props = {
	src: string | null
	playing: boolean
	onPlay: () => void
	onStop: () => void
	onStatus?: (status: PlayerStatus) => void
	volume?: number
}

// The NTS live streams are continuous Icecast-style connections with no
// manifest. When a CDN edge drops us, or the machine sleeps, or the network
// blips, the audio element just goes quiet: it does not retry on its own, and
// often does not even fire an `error`. These drive a watchdog that notices and
// reconnects.
const STALL_TIMEOUT = 10_000
const STALL_POLL = 2_000
const BACKOFF_MIN = 1_000
const BACKOFF_MAX = 30_000

// MEDIA_ERR_SRC_NOT_SUPPORTED. A transient CDN hiccup can surface this way, so
// don't give up on the first one, but a source the browser genuinely cannot
// decode will never succeed and must not be retried forever.
const ERR_SRC_NOT_SUPPORTED = 4
const MAX_FORMAT_FAILURES = 5

function reconnectURL(src: string, attempt: number): string {
	// Vary the URL so we open a genuinely new connection rather than having a
	// dead one served back to us.
	const separator = src.includes("?") ? "&" : "?"
	return `${src}${separator}_reconnect=${attempt}`
}

export function Player(props: Props) {
	const { src, playing, onStop, onPlay, onStatus, volume = 1 } = props

	const ref = useRef<HTMLAudioElement | null>(null)

	// Held in a ref so changing the callback doesn't tear down the watchdog.
	const statusHandler = useRef(onStatus)
	statusHandler.current = onStatus
	const status = useRef<PlayerStatus>("idle")

	const report = useCallback(function (next: PlayerStatus) {
		if (status.current === next) {
			return
		}
		status.current = next
		statusHandler.current?.(next)
	}, [])

	// Whether the user wants audio, as opposed to whether the element happens to
	// be playing right now. The watchdog must only act when these disagree.
	const wanted = useRef(playing)
	wanted.current = playing

	// Set while we tear a connection down and open a new one, so the resulting
	// `pause` event isn't reported to the parent as the user stopping playback.
	const reconnecting = useRef(false)

	const attempts = useRef(0)
	const formatFailures = useRef(0)
	const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
	const progressedAt = useRef(0)
	const position = useRef(0)

	const clearRetry = useCallback(function () {
		if (retry.current !== null) {
			clearTimeout(retry.current)
			retry.current = null
		}
	}, [])

	const reconnect = useCallback(
		function () {
			// Never stack attempts: one in flight at a time.
			if (!wanted.current || !src || retry.current !== null) {
				return
			}

			// Nothing to gain from hammering a source that cannot be decoded.
			if (formatFailures.current >= MAX_FORMAT_FAILURES) {
				report("failed")
				return
			}

			report("reconnecting")

			const wait = Math.min(BACKOFF_MIN * 2 ** attempts.current, BACKOFF_MAX)
			attempts.current += 1

			retry.current = setTimeout(function () {
				retry.current = null

				const audio = ref.current
				if (!audio || !wanted.current) {
					return
				}

				reconnecting.current = true
				progressedAt.current = Date.now()
				position.current = 0

				audio.src = reconnectURL(src, attempts.current)
				audio.load()
				audio.play().then(
					function () {
						reconnecting.current = false
					},
					function () {
						reconnecting.current = false
						// Still down. Back off and try again.
						reconnect()
					},
				)
			}, wait)
		},
		[src, report],
	)

	useEffect(
		function () {
			const audio = ref.current
			if (!audio) {
				return
			}

			function handlePlay() {
				onPlay()
			}

			function handlePause() {
				// Swapping connections pauses the element. That isn't the user
				// stopping, and reporting it as such would cancel the reconnect.
				if (reconnecting.current) {
					return
				}
				onStop()
			}

			audio.addEventListener("play", handlePlay)
			audio.addEventListener("pause", handlePause)

			return function () {
				audio.removeEventListener("play", handlePlay)
				audio.removeEventListener("pause", handlePause)
			}
		},
		[onPlay, onStop],
	)

	useEffect(
		function () {
			const audio = ref.current
			if (!audio) {
				return
			}

			if (!playing || !src) {
				clearRetry()
				attempts.current = 0
				formatFailures.current = 0
				reconnecting.current = false
				audio.pause()
				report("idle")
				return
			}

			progressedAt.current = Date.now()
			position.current = audio.currentTime
			report("connecting")

			audio.load()
			audio.play().catch(function () {
				reconnect()
			})

			function noteProgress() {
				// Read fresh: the poll below can outlive the element.
				const current = ref.current
				if (!current || current.currentTime === position.current) {
					return
				}
				// The clock is advancing, so the stream is healthy: clear the backoff
				// so the next unrelated drop recovers immediately.
				position.current = current.currentTime
				progressedAt.current = Date.now()
				attempts.current = 0
				formatFailures.current = 0
				report("playing")
			}

			function handleFailure() {
				const code = ref.current?.error?.code
				if (code === ERR_SRC_NOT_SUPPORTED) {
					formatFailures.current += 1
				} else {
					formatFailures.current = 0
				}
				reconnect()
			}

			function handleOnline() {
				// The network just came back, so don't sit through the backoff, and
				// give a source that previously failed to decode another chance.
				attempts.current = 0
				formatFailures.current = 0
				clearRetry()
				reconnect()
			}

			// A live stream should never end. If it does, the connection dropped.
			audio.addEventListener("error", handleFailure)
			audio.addEventListener("ended", handleFailure)
			audio.addEventListener("timeupdate", noteProgress)
			window.addEventListener("online", handleOnline)

			// The failure the events miss: still nominally playing, but the clock
			// stopped advancing and nothing was raised.
			const poll = setInterval(function () {
				noteProgress()
				if (Date.now() - progressedAt.current > STALL_TIMEOUT) {
					reconnect()
				}
			}, STALL_POLL)

			return function () {
				clearInterval(poll)
				audio.removeEventListener("error", handleFailure)
				audio.removeEventListener("ended", handleFailure)
				audio.removeEventListener("timeupdate", noteProgress)
				window.removeEventListener("online", handleOnline)
			}
		},
		[playing, src, reconnect, clearRetry, report],
	)

	useEffect(
		function () {
			if (!ref.current) {
				return
			}
			ref.current.volume = volume
		},
		[volume],
	)

	useEffect(
		function () {
			return function () {
				clearRetry()
			}
		},
		[clearRetry],
	)

	return <audio src={src ?? undefined} ref={ref} />
}
