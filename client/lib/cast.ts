import { useCallback, useEffect, useState } from "react"

import { electron } from "../electron"

export type CastDevice = {
	id: string
	name: string
	host: string
	port: number
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

export type CastMedia = {
	url: string
	contentType: string
	title: string
	subtitle?: string
	image?: string
	hlsSegmentFormat?: "mp3" | "aac"
}

// Cast targets share the output picker with real sound cards, so their ids are
// prefixed to keep the two apart. A device id from enumerateDevices is a long
// hex digest and will never collide with this.
const PREFIX = "cast:"

export function castTargetId(deviceId: string): string {
	return `${PREFIX}${deviceId}`
}

/** The Cast device id behind an output selection, or null if it is a local one. */
export function castDeviceId(outputDevice: string): string | null {
	return outputDevice.startsWith(PREFIX) ? outputDevice.slice(PREFIX.length) : null
}

/**
 * Cast devices on the network.
 *
 * Nothing happens until `discover` is called. Browsing for devices binds a
 * multicast socket, and on Windows binding one is what makes Defender ask the
 * user to allow the app through the firewall. Most people running a radio
 * player own no Cast device at all, and asking all of them to approve a
 * firewall exception for a feature they will never open would be a poor trade.
 * So it starts when someone actually looks at the output picker.
 */
export function useCastDevices(): {
	devices: CastDevice[]
	discover: () => void
	idle: () => void
	rescan: () => void
} {
	const [devices, setDevices] = useState<CastDevice[]>([])

	useEffect(function () {
		let cancelled = false

		// Devices answer mDNS at their own pace, so the list arrives in pieces
		// rather than all at once.
		const unsubscribe = electron.addListener(
			"cast-devices",
			function (_evt: Event, found: CastDevice[]) {
				if (!cancelled) {
					setDevices(found)
				}
			},
		)

		return function () {
			// Both matter: unsubscribing stops future pushes, and the flag stops the
			// discover call above from setting state if it resolves after unmount.
			cancelled = true
			unsubscribe()
		}
	}, [])

	// Safe to call repeatedly: the main process ignores a second start.
	const discover = useCallback(function () {
		electron.invoke("cast-discover").then(function (found: CastDevice[] | null) {
			if (Array.isArray(found)) {
				setDevices(found)
			}
		})
	}, [])

	const rescan = useCallback(function () {
		electron.send("cast-rescan")
	}, [])

	// Called when the picker closes. The main process keeps browsing while a
	// session is live, so this cannot cut the ground from under an active cast.
	const idle = useCallback(function () {
		electron.send("cast-discover-stop")
	}, [])

	return { devices, discover, idle, rescan }
}

/** What the device is currently doing, as reported by the main process. */
export function useCastState(): CastState {
	const [state, setState] = useState<CastState>({ status: "idle", device: null })

	useEffect(function () {
		return electron.addListener(
			"cast-state",
			function (_evt: Event, next: CastState) {
				setState(next)
			},
		)
	}, [])

	return state
}

export async function startCast(
	deviceId: string,
	media: CastMedia,
): Promise<{ started: boolean; reason?: string }> {
	const result = await electron.invoke("cast-start", deviceId, media)
	return result ?? { started: false, reason: "casting is unavailable" }
}

export function stopCast(): void {
	electron.send("cast-stop")
}

/** Volume on the device, since the local element is not in the path. */
export function setCastVolume(level: number, muted: boolean): void {
	electron.send("cast-volume", level, muted)
}
