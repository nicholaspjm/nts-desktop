import { useCallback, useEffect, useRef, useState } from "react"

// How long a saved device must stay absent before the choice is abandoned.
// Windows in particular drops and re-adds devices on sleep, dock changes and
// driver restarts, and forgetting the choice on the first blink would be worse
// than the bug this reconciliation exists to fix.
const FORGET_AFTER = 10_000

export type AudioOutput = {
	id: string
	label: string
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
	const missingSince = useRef<number | null>(null)

	useEffect(
		function () {
			// An empty list means enumeration has not happened yet or just failed.
			// Neither is evidence that the saved device is gone, and clearing the
			// preference on a false alarm would lose a deliberate choice.
			if (deviceId === "" || outputs.length === 0) {
				missingSince.current = null
				return
			}

			if (outputs.some((o) => o.id === deviceId)) {
				missingSince.current = null
				return
			}

			// Unplugged is not the same as gone for good, and someone moving desks
			// should not have to reselect their interface when they plug back in.
			// A device has to stay missing before the choice is given up.
			if (missingSince.current === null) {
				missingSince.current = Date.now()
			}

			const elapsed = Date.now() - missingSince.current
			if (elapsed >= FORGET_AFTER) {
				missingSince.current = null
				onReset()
				return
			}

			const timer = setTimeout(function () {
				missingSince.current = null
				onReset()
			}, FORGET_AFTER - elapsed)

			return function () {
				clearTimeout(timer)
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
