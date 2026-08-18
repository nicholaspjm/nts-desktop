import { useEffect, useRef, useState } from "react"

import { electron } from "../electron"

export type StreamProbe = {
	// What the server claims in its ICY headers.
	reported: {
		bitrate: number | null
		sampleRate: number | null
		contentType: string
		station: string
	}
	// What the audio frames themselves prove. Null when the bytes could not be
	// decoded, in which case nothing measured should be shown.
	measured: {
		codec: string
		bitrate: number | null
		sampleRate: number | null
		channelMode: string
		frames: number
	} | null
	edge: string
}

export type StreamInfoState = {
	probe: StreamProbe | null
	loading: boolean
}

/**
 * Broadcast parameters for the current stream.
 *
 * Runs in the main process. The relay fronting these streams answers its 302
 * without Access-Control-Allow-Origin, so a renderer-side fetch cannot read the
 * headers, and requesting them in CORS mode breaks the audio load outright.
 */
export function useStreamInfo(src: string | null): StreamInfoState {
	const [state, setState] = useState<StreamInfoState>({
		probe: null,
		loading: false,
	})
	const request = useRef(0)

	useEffect(
		function () {
			if (!src) {
				setState({ probe: null, loading: false })
				return
			}

			const id = request.current + 1
			request.current = id
			setState({ probe: null, loading: true })

			electron
				.invoke("stream-info", src)
				.then(function (probe: StreamProbe | null) {
					// A newer source was selected while this was in flight.
					if (request.current !== id) {
						return
					}
					setState({ probe, loading: false })
				})
				.catch(function () {
					if (request.current !== id) {
						return
					}
					setState({ probe: null, loading: false })
				})
		},
		[src],
	)

	return state
}

export type HealthSample = {
	// Seconds of audio buffered ahead of the playhead.
	buffered: number
	reconnecting: boolean
}

export type StreamHealth = {
	history: HealthSample[]
	buffered: number
	uptime: number
	reconnects: number
}

const HISTORY_POINTS = 160
const SAMPLE_INTERVAL = 500

/**
 * Samples how far ahead the element has buffered, which is the honest measure
 * of whether a stream is about to stutter. Reads only element properties, so
 * unlike Web Audio metering it needs no CORS access to the audio itself.
 */
export function useStreamHealth(
	element: HTMLAudioElement | null,
	active: boolean,
	reconnecting: boolean,
): StreamHealth {
	const [health, setHealth] = useState<StreamHealth>({
		history: [],
		buffered: 0,
		uptime: 0,
		reconnects: 0,
	})

	const history = useRef<HealthSample[]>([])
	const startedAt = useRef(0)
	const reconnects = useRef(0)
	const wasReconnecting = useRef(false)
	const flag = useRef(reconnecting)
	flag.current = reconnecting

	useEffect(
		function () {
			if (!element || !active) {
				history.current = []
				startedAt.current = 0
				reconnects.current = 0
				setHealth({ history: [], buffered: 0, uptime: 0, reconnects: 0 })
				return
			}

			startedAt.current = Date.now()

			const timer = setInterval(function () {
				const el = element
				let buffered = 0
				try {
					const ranges = el.buffered
					if (ranges.length > 0) {
						buffered = Math.max(0, ranges.end(ranges.length - 1) - el.currentTime)
					}
				} catch {
					// buffered can throw while the element is resetting.
				}

				if (flag.current && !wasReconnecting.current) {
					reconnects.current += 1
				}
				wasReconnecting.current = flag.current

				const next = [
					...history.current,
					{ buffered, reconnecting: flag.current },
				].slice(-HISTORY_POINTS)
				history.current = next

				setHealth({
					history: next,
					buffered,
					uptime: Math.round((Date.now() - startedAt.current) / 1000),
					reconnects: reconnects.current,
				})
			}, SAMPLE_INTERVAL)

			return function () {
				clearInterval(timer)
			}
		},
		[element, active],
	)

	return health
}

/**
 * Exponential moving average. The raw buffer trace is a sawtooth, which reads
 * as alarming noise rather than as the trend the graph is meant to show.
 */
export function smooth(values: number[], factor = 0.25): number[] {
	if (values.length === 0) {
		return values
	}

	const out: number[] = []
	let acc = values[0]
	for (const value of values) {
		acc = acc + (value - acc) * factor
		out.push(acc)
	}
	return out
}
