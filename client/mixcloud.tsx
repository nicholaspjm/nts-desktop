import { useEffect, useRef, useState } from "react"
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

// A drag fires onChange on every input event, so one drag is dozens of requests
// and only the last is the one meant. Waiting this long before acting collapses
// them into a single seek, which also stops the audio stuttering through every
// point dragged past.
const SEEK_SETTLE = 150

export function Mixcloud(props: Props) {
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
	const [widget, setWidget] = useState<Mixcloud.PlayerWidget | null>(null)

	useEffect(
		function () {
			if (!ref.current || !show) {
				return
			}

			// @ts-expect-error
			const w = window.Mixcloud.PlayerWidget(ref.current) as Mixcloud.PlayerWidget

			let cancelled = false
			let bound = false

			w.ready
				.then(function () {
					// The effect may have been torn down while the widget was still
					// getting ready, in which case binding now would leave listeners
					// behind with nothing to remove them.
					if (cancelled) {
						return
					}
					w.events.play.on(onPlay)
					w.events.pause.on(onStop)
					w.events.ended.on(onStop)
					w.events.progress.on(onProgress)
					bound = true
					w.getDuration().then((duration) => onLoad(duration))
					setWidget(w)
				})
				.catch((err) => console.error(err))

			// There was no cleanup here at all, so every run of this effect added
			// four more listeners to the same iframe and removed none. Switching
			// shows, or anything else that re-ran it, accumulated them.
			return function () {
				cancelled = true
				if (!bound) {
					return
				}
				try {
					w.events.play.off(onPlay)
					w.events.pause.off(onStop)
					w.events.ended.off(onStop)
					w.events.progress.off(onProgress)
				} catch {
					// The iframe can be gone already, which is the case this is for.
				}
			}
		},
		[show, onLoad, onPlay, onStop, onProgress],
	)

	// As in soundcloud.tsx: only a request from the user seeks. Watching the
	// playback position meant the widget's own progress was fed back to it.
	useEffect(
		function () {
			if (!widget || !seek) {
				return
			}

			const timer = setTimeout(function () {
				widget.seek(seek.to)
			}, SEEK_SETTLE)

			return function () {
				clearTimeout(timer)
			}
		},
		[seek, widget],
	)

	useEffect(
		function () {
			if (playing && show) {
				widget?.play()
				return
			}

			widget?.pause()
		},
		[playing, widget, show],
	)

	useEffect(
		function () {
			widget?.setVolume(volume)
		},
		[volume, widget],
	)

	if (!show) {
		return null
	}

	const feed = encodeURIComponent(key(show.source.url))
	return (
		<iframe
			ref={ref}
			src={`https://www.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&feed=${feed}`}
			// As in soundcloud.tsx: speaker-selection to allow the routing, microphone
			// to make the device names readable, capture refused in the main process.
			// The widget URL redirects to player-widget.mixcloud.com, and a permission
			// delegated only to the src origin is dropped on the way, so the
			// destination is named too or the routing silently does nothing.
			allow="autoplay 'src' https://player-widget.mixcloud.com; speaker-selection 'src' https://player-widget.mixcloud.com; microphone 'src' https://player-widget.mixcloud.com"
			className={css.frame}
		/>
	)
}

function key(url: string) {
	return url.replace(/^https:\/\/www\.mixcloud\.com/, "")
}
