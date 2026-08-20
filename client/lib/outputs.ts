import { useCallback, useEffect, useRef, useState } from "react"

export type AudioOutput = {
	id: string
	label: string
	// Set for devices on the network rather than sound cards on this machine.
	// They are offered in the same picker but behave completely differently: a
	// Cast device fetches the stream itself instead of being fed by the browser.
	cast?: boolean
}

/**
 * The audio output devices the OS is offering, and a way to ask again.
 *
 * Electron populates device labels without a permission prompt, unlike a plain
 * browser, so these can be listed directly. The list refreshes itself when
 * devices are plugged or unplugged, but `devicechange` is not dependable for
 * output-only changes on every platform, so the caller is handed a manual
 * refresh as a backstop.
 */
export function useAudioOutputs(): {
	outputs: AudioOutput[]
	refresh: () => void
} {
	const [outputs, setOutputs] = useState<AudioOutput[]>([])
	const cancelled = useRef(false)

	const load = useCallback(function () {
		navigator.mediaDevices
			.enumerateDevices()
			.then(function (devices) {
				if (cancelled.current) {
					return
				}
				setOutputs(
					devices
						.filter((d) => d.kind === "audiooutput")
						.map((d) => ({
							id: d.deviceId,
							label: d.label || "Unnamed output",
						})),
				)
			})
			.catch(function (err) {
				// Deliberately keeps the previous list. Emptying it hides the output
				// controls entirely, so a momentary failure to enumerate would look
				// like the feature had been removed.
				console.warn("could not list audio outputs:", err)
			})
	}, [])

	useEffect(
		function () {
			cancelled.current = false
			load()
			navigator.mediaDevices.addEventListener("devicechange", load)

			return function () {
				cancelled.current = true
				navigator.mediaDevices.removeEventListener("devicechange", load)
			}
		},
		[load],
	)

	return { outputs, refresh: load }
}

/**
 * Forgets a saved output device that no longer exists.
 *
 * Nothing used to reconcile the stored id against reality. A device that had
 * been unplugged left a dead id in preferences forever: setSinkId rejected,
 * audio quietly fell back to the system default, and both dropdowns rendered
 * blank because the value they were given matched no option. The app showed
 * nothing selected while sound came out of somewhere else.
 */
export function useReconcileOutput(
	outputs: AudioOutput[],
	deviceId: string,
	onReset: () => void,
): void {
	useEffect(
		function () {
			// An empty list means enumeration has not happened yet or just failed.
			// Neither is evidence that the saved device is gone, and clearing the
			// preference on a false alarm would lose a deliberate choice.
			if (deviceId === "" || outputs.length === 0) {
				return
			}

			if (!outputs.some((o) => o.id === deviceId)) {
				onReset()
			}
		},
		[outputs, deviceId, onReset],
	)
}

type SinkCapable = HTMLAudioElement & {
	setSinkId?: (id: string) => Promise<void>
}

/**
 * Routes the element to the chosen output. Falls back silently to the system
 * default: a device can disappear between being chosen and being applied, and
 * losing audio entirely would be a far worse outcome than ignoring the setting.
 */
export function useAudioOutput(
	element: HTMLAudioElement | null,
	deviceId: string,
): void {
	useEffect(
		function () {
			const el = element as SinkCapable | null
			if (!el || typeof el.setSinkId !== "function") {
				return
			}

			el.setSinkId(deviceId).catch(function (err) {
				console.warn("could not switch audio output:", err)
				if (deviceId !== "") {
					el.setSinkId?.("").catch(() => {})
				}
			})
		},
		[element, deviceId],
	)
}
