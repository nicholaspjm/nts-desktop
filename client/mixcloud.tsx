import { useEffect, useRef, useState } from "react"
import type { ShowInfo } from "~/app/show"

import css from "./mixcloud.module.css"

type Props = {
	show: ShowInfo | null
	playing: boolean
	onStop: () => void
	onPlay: () => void
	onProgress: (pos: number) => void
	onLoad: (dur: number) => void
	position: number
	volume?: number
}

export function Mixcloud(props: Props) {
	const {
		show,
		playing,
		onStop,
		onPlay,
		onProgress,
		onLoad,
		position,
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

	useEffect(
		function () {
			if (!widget) {
				return
			}

			widget.getPosition().then(function (curr) {
				if (Math.abs(position - curr) < 1) {
					return
				}
				widget.seek(position)
			})
		},
		[position, widget],
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
