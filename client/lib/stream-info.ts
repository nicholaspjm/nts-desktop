import { useEffect, useRef, useState } from "react"

import { electron } from "../electron"

export type StreamInfo = {
	bitrate: number | null
	sampleRate: number | null
	codec: string
	station: string
	edge: string
}

export type StreamInfoState = {
	info: StreamInfo | null
	loading: boolean
}

/**
 * Broadcast parameters for the current stream, read from its ICY headers.
 *
 * The work happens in the main process. The relay that fronts these streams
 * answers its 302 without any Access-Control-Allow-Origin, so a renderer-side
 * fetch cannot read the headers, and asking for them in CORS mode is worse than
 * useless: it breaks the audio load.
 */
export function useStreamInfo(src: string | null): StreamInfoState {
	const [state, setState] = useState<StreamInfoState>({
		info: null,
		loading: false,
	})
	const request = useRef(0)

	useEffect(
		function () {
			if (!src) {
				setState({ info: null, loading: false })
				return
			}

			const id = request.current + 1
			request.current = id
			setState({ info: null, loading: true })

			electron
				.invoke("stream-info", src)
				.then(function (info: StreamInfo | null) {
					// A newer source was selected while this was in flight.
					if (request.current !== id) {
						return
					}
					setState({ info, loading: false })
				})
				.catch(function () {
					if (request.current !== id) {
						return
					}
					setState({ info: null, loading: false })
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
