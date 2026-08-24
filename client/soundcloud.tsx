import { useEffect, useRef } from "react"
import type { ShowInfo } from "~/app/show"
import type { SeekRequest } from "./lib/seek"

import css from "./mixcloud.module.css"

type Props = {
	show: ShowInfo | null
	playing: boolean
	onStop: () => void
	onPlay: () => void
	onProgress: (pos: number) => void
	onLoad: (dur: number) => void
	seek: SeekRequest | null
	volume?: number
}

type SCWidget = {
	getPosition(callback: (pos: number) => void): void
	getDuration(callback: (dur: number) => void): void
	seekTo(pos: number): void
	play(): void
	pause(): void
	setVolume(volume: number): void
}

// A drag fires onChange on every input event, so one drag is dozens of requests
// and only the last is the one meant. Waiting this long before acting collapses
// them into a single seek, which also stops the audio stuttering through every
// point dragged past.
const SEEK_SETTLE = 150

export function Soundcloud(props: Props) {
	const {
		show,
		playing,
		onStop,
		onPlay,
		onProgress,
		onLoad,
		seek,
		volume = 1,
	} = props

	const ref = useRef<HTMLIFrameElement | null>(null)
	const widget = useRef<SCWidget | null>(null)

	// Whether the app wants sound, as opposed to whether the widget happens to be
	// ready. The READY handler is bound once, so it cannot read `playing`
	// directly without seeing a stale value.
	const wanted = useRef(playing)
	wanted.current = playing

	useEffect(
		function () {
			if (!ref.current || !show) {
				return
			}

			if (widget.current) {
				return
			}

			// @ts-expect-error
			const Events = SC.Widget.Events

			// @ts-expect-error
			const w = SC.Widget(ref.current)
			w.bind(Events.PLAY, onPlay)
			w.bind(Events.PAUSE, onStop)
			w.bind(Events.FINISH, onStop)
			w.bind(Events.PLAY_PROGRESS, function (evt: { currentPosition: number }) {
				const position = evt.currentPosition / 1000
				const rounded = Math.round(position)

				onProgress(rounded)
			})
			w.bind(Events.READY, function () {
				w.getDuration(function (duration: number) {
					onLoad(duration / 1000)
				})

				// Only if the app actually asked for playback. This used to play
				// unconditionally, so opening a show to read its details started it.
				// Read through a ref because this handler is bound once and would
				// otherwise see `playing` as it was when the widget was created.
				if (wanted.current) {
					w.play()
				}
				widget.current = w
			})

			return function () {
				// Unbinding reaches into the iframe, which React has often already
				// removed by this point when the show is changing. A throw here is
				// during unmount, where it takes the tree down with it.
				try {
					w.unbind(Events.PLAY)
					w.unbind(Events.PAUSE)
					w.unbind(Events.FINISH)
					w.unbind(Events.PLAY_PROGRESS)
					w.unbind(Events.READY)
				} catch {
					// Already gone, which is the outcome this wanted anyway.
				}
			}
		},
		[show, onStop, onLoad, onPlay, onProgress],
	)

	// Acts only on what the user asked for. This used to watch the playback
	// position and compare it against the widget's own, which meant a progress
	// report arriving late looked like a request to move and undid the seek that
	// had just been made.
	useEffect(
		function () {
			const w = widget.current
			if (!w || !seek) {
				return
			}

			const timer = setTimeout(function () {
				w.seekTo(seek.to * 1000)
			}, SEEK_SETTLE)

			return function () {
				clearTimeout(timer)
			}
		},
		[seek],
	)

	useEffect(
		function () {
			if (!widget.current) {
				return
			}

			if (playing && show) {
				widget.current.play()
				return
			}

			widget.current.pause()
		},
		[playing, show],
	)

	useEffect(
		function () {
			if (!widget.current) {
				return
			}
			widget.current.setVolume(volume * 100)
		},
		[volume],
	)

	if (!show) {
		return null
	}

	const feed = encodeURIComponent(show.source.url)
	return (
		<iframe
			ref={ref}
			src={`https://w.soundcloud.com/player/?url=${feed}`}
			// speaker-selection lets this frame's audio be routed to a chosen device,
			// and microphone is what makes the device names readable inside the frame:
			// Chromium hides output ids from a frame without it, and an id that cannot
			// be read cannot be routed to. Nothing can actually record, because the
			// main process refuses every capture request. See app/frame-audio.ts.
			allow="autoplay 'src'; speaker-selection 'src'; microphone 'src'"
			className={css.frame}
		/>
	)
}
