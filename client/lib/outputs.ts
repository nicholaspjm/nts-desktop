import { useEffect, useState } from "react"

export type AudioOutput = {
	id: string
	label: string
}

/**
 * The audio output devices the OS is offering.
 *
 * Electron populates device labels without a permission prompt, unlike a plain
 * browser, so these can be listed directly. The list is refreshed when devices
 * are plugged or unplugged.
 */
export function useAudioOutputs(): AudioOutput[] {
	const [outputs, setOutputs] = useState<AudioOutput[]>([])

	useEffect(function () {
		let cancelled = false

		function load() {
			navigator.mediaDevices
				.enumerateDevices()
				.then(function (devices) {
					if (cancelled) {
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
				.catch(function () {
					if (!cancelled) {
						setOutputs([])
					}
				})
		}

		load()
		navigator.mediaDevices.addEventListener("devicechange", load)

		return function () {
			cancelled = true
			navigator.mediaDevices.removeEventListener("devicechange", load)
		}
	}, [])

	return outputs
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
