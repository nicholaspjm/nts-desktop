import { useEffect } from "react"

/**
 * Whether typing into this element should win over a shortcut.
 *
 * The search box is the reason this exists: pressing 1 while searching should
 * type a 1, not switch channel.
 */
function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false
	}
	const tag = target.tagName
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		target.isContentEditable
	)
}

/**
 * Whether this key already does something to the focused element.
 *
 * A focused button is activated by space and enter, so firing a shortcut on
 * those as well would do two things at once: press the button under the cursor
 * and toggle playback. Every other key is free.
 */
function alreadyHandled(target: EventTarget | null, key: string): boolean {
	if (key !== " " && key !== "Enter") {
		return false
	}
	if (!(target instanceof HTMLElement)) {
		return false
	}
	const tag = target.tagName
	return tag === "BUTTON" || tag === "A"
}

export function useKeydown(key: string, handler: () => void, deps: any[] = []) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: we're using a dep array here
	useEffect(function () {
		function handle(evt: KeyboardEvent) {
			if (evt.key !== key) {
				return
			}

			// This used to require the target to be document.body, which meant every
			// shortcut stopped working the moment anything was clicked, since the
			// button kept focus. In the mini player, where nearly the whole surface
			// is a button, that left no working shortcuts at all.
			if (isEditable(evt.target) || alreadyHandled(evt.target, key)) {
				return
			}

			evt.preventDefault()
			handler()
		}

		window.addEventListener("keydown", handle)
		return () => window.removeEventListener("keydown", handle)
	}, deps)
}
