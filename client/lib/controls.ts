import { useEffect, useRef, useState } from "react"

import { electron } from "../electron"

/**
 * Hardware media keys.
 *
 * The keyboard's play/pause key, and the button on a pair of headphones, reach
 * the page through the media session rather than as ordinary key events, so
 * they do nothing at all unless handlers are registered. For an app meant to
 * play in the background while you do something else, that matters.
 */
export function useMediaKeys(
	playing: boolean,
	onPlay: () => void,
	onStop: () => void,
) {
	// Held in refs so re-registering does not depend on callback identity.
	const play = useRef(onPlay)
	const stop = useRef(onStop)
	play.current = onPlay
	stop.current = onStop

	useEffect(function () {
		if (!("mediaSession" in navigator)) {
			return
		}

		const session = navigator.mediaSession
		try {
			session.setActionHandler("play", () => play.current())
			session.setActionHandler("pause", () => stop.current())
			session.setActionHandler("stop", () => stop.current())
		} catch {
			// Older runtimes reject unknown actions; nothing to do about it.
		}

		return function () {
			try {
				session.setActionHandler("play", null)
				session.setActionHandler("pause", null)
				session.setActionHandler("stop", null)
			} catch {}
		}
	}, [])

	useEffect(
		function () {
			if (!("mediaSession" in navigator)) {
				return
			}
			// Keeps the OS transport showing the right state.
			navigator.mediaSession.playbackState = playing ? "playing" : "paused"
		},
		[playing],
	)
}

export type SleepTimer = {
	// Seconds left, or null when no timer is set.
	remaining: number | null
	set: (minutes: number) => void
	cancel: () => void
}

const FADE_SECONDS = 20

/**
 * Stops playback after a chosen interval, fading over the last stretch rather
 * than cutting, which is unpleasant if you are still awake to hear it.
 *
 * The fade is applied as a multiplier so the stored volume is never touched:
 * cancelling mid-fade returns to exactly the level that was set.
 */
export function useSleepTimer(
	playing: boolean,
	onStop: () => void,
	onFade: (multiplier: number) => void,
): SleepTimer {
	const [endsAt, setEndsAt] = useState<number | null>(null)
	const [remaining, setRemaining] = useState<number | null>(null)

	const stop = useRef(onStop)
	const fade = useRef(onFade)
	stop.current = onStop
	fade.current = onFade

	useEffect(
		function () {
			if (endsAt === null) {
				setRemaining(null)
				fade.current(1)
				return
			}

			const tick = setInterval(function () {
				const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000))
				setRemaining(left)

				if (left <= 0) {
					setEndsAt(null)
					fade.current(1)
					stop.current()
					return
				}

				fade.current(left < FADE_SECONDS ? left / FADE_SECONDS : 1)
			}, 500)

			return function () {
				clearInterval(tick)
			}
		},
		[endsAt],
	)

	// A timer with nothing playing is just a pending surprise.
	useEffect(
		function () {
			if (!playing && endsAt !== null) {
				setEndsAt(null)
			}
		},
		[playing, endsAt],
	)

	return {
		remaining,
		set: (minutes: number) => setEndsAt(Date.now() + minutes * 60_000),
		cancel: () => setEndsAt(null),
	}
}

export type HistoryEntry = {
	name: string
	kind: "channel" | "mixtape" | "archive"
	url?: string
	detail?: string
	at: string
}

export function useHistory(refreshKey: number): HistoryEntry[] {
	const [entries, setEntries] = useState<HistoryEntry[]>([])

	// refreshKey is a prop, not an outer-scope value: it changes on every render
	// that should re-read the list, so the dependency is real.
	// biome-ignore lint/correctness/useExhaustiveDependencies: prop, not outer scope
	useEffect(
		function () {
			let cancelled = false
			electron
				.invoke("history")
				.then(function (list: HistoryEntry[] | null) {
					if (!cancelled) {
						setEntries(Array.isArray(list) ? list : [])
					}
				})
				.catch(() => {})
			return function () {
				cancelled = true
			}
		},
		[refreshKey],
	)

	return entries
}
