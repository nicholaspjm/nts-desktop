import { type Session, type WebContents, type WebFrameMain, session } from "electron"

/**
 * Routing the embedded players to a chosen audio output.
 *
 * Recorded shows play inside a SoundCloud or Mixcloud iframe, which is a
 * different origin from the app. That makes the obvious approach impossible in
 * three separate ways, each of which had to be worked around:
 *
 *  1. setSinkId only ever applies to a media element the calling document owns,
 *     so the renderer cannot route the frame. The main process can, because it
 *     reaches each frame directly rather than through the page.
 *
 *  2. Neither player keeps its audio somewhere a document query can find it.
 *     SoundCloud plays through a detached `new Audio()` piped into an
 *     AudioContext, so querySelectorAll("audio, video") returns nothing at all
 *     and the element's own sink is not in the audio path; the AudioContext is.
 *     Mixcloud uses a plain element and no AudioContext. So both are hooked at
 *     the constructor and both kinds of target are routed.
 *
 *  3. Device ids are salted per origin. The id the app holds is meaningless
 *     inside the player's frame, which is why passing it there rejected with
 *     NotFoundError. Devices are therefore matched by label, which is the only
 *     key that means the same thing on both sides.
 *
 * Verified by measurement rather than by return value: with a virtual cable
 * selected, the cable carried the show at -19 dB where it had been at the -91 dB
 * silence floor, for both players.
 */

// The player origins. Mixcloud is listed twice on purpose: the widget URL
// redirects across origins, and a permission delegated to the src origin is
// dropped on the way, so the destination has to be named as well.
export const SOUNDCLOUD_ORIGIN = "https://w.soundcloud.com"
export const MIXCLOUD_ORIGIN = "https://player-widget.mixcloud.com"

function isPlayerFrame(frame: WebFrameMain): boolean {
	return (
		frame.url.startsWith(SOUNDCLOUD_ORIGIN) || frame.url.startsWith(MIXCLOUD_ORIGIN)
	)
}

/**
 * Permissions the app has no use for, refused wherever they are asked from.
 *
 * "media" is absent because it is handled separately: reported as granted so
 * that device labels are readable, and refused when actually requested.
 */
const UNUSED = new Set([
	"geolocation",
	"notifications",
	"midi",
	"midiSysex",
	"hid",
	"serial",
	"usb",
	"display-capture",
	"idle-detection",
	"window-management",
	"clipboard-read",
	"pointerLock",
])

/**
 * Lets the players read device names without letting them record anything.
 *
 * Chromium hides output device ids and labels from a frame that does not hold
 * microphone permission, and hidden ids cannot be routed to. So the players are
 * told the permission is granted, which is what unlocks the names, while every
 * actual capture request is refused. Both halves are required: without the
 * first the device list comes back as a single empty entry, and without the
 * second the microphone policy the players are granted would be real.
 *
 * This matters more than it looks. Electron grants permission requests by
 * default when no handler is installed, so the refusal below is what keeps the
 * grant on paper.
 */
export function installPermissionHandlers(
	ses: Session = session.defaultSession,
): void {
	ses.setPermissionCheckHandler(function (_wc, permission) {
		if (permission === "media") {
			return true
		}
		return !UNUSED.has(permission)
	})

	ses.setPermissionRequestHandler(function (_wc, permission, callback) {
		// Refusing "media" is the safety gate for the microphone permission the
		// player frames are granted. Confirmed: getUserMedia inside the frame
		// rejects with NotAllowedError while the device names stay readable.
		callback(permission !== "media" && !UNUSED.has(permission))
	})
}

/**
 * Installed into a player frame to capture whatever it plays through.
 *
 * Both targets are remembered as they are constructed rather than searched for
 * afterwards, since neither is reachable from the document. The chosen output
 * is stored so that anything created later is routed as it appears, which is
 * what makes this survive the widget building its AudioContext lazily on first
 * play, well after the frame has loaded.
 */
const HOOK = `(function () {
	if (window.__ntsAudio) {
		return "already"
	}

	var state = { sink: null, targets: [] }
	window.__ntsAudio = state

	function apply(target) {
		if (state.sink === null || !target || typeof target.setSinkId !== "function") {
			return
		}

		// An empty choice means the system default, which is the one id that is
		// spelled the same everywhere and needs no lookup.
		if (state.sink === "") {
			try {
				var back = target.setSinkId("")
				if (back && back.catch) { back.catch(function () {}) }
			} catch (err) {}
			return
		}

		navigator.mediaDevices.enumerateDevices().then(function (devices) {
			var match = null
			for (var i = 0; i < devices.length; i++) {
				if (devices[i].kind === "audiooutput" && devices[i].label === state.sink) {
					match = devices[i]
					break
				}
			}
			if (!match) {
				return
			}
			try {
				var done = target.setSinkId(match.deviceId)
				if (done && done.catch) { done.catch(function () {}) }
			} catch (err) {}
		}, function () {})
	}

	function remember(target) {
		if (state.targets.indexOf(target) < 0) {
			state.targets.push(target)
		}
		apply(target)
	}

	var play = HTMLMediaElement.prototype.play
	HTMLMediaElement.prototype.play = function () {
		remember(this)
		return play.apply(this, arguments)
	}

	var Native = window.AudioContext || window.webkitAudioContext
	if (Native) {
		var Wrapped = function (options) {
			var ctx = new Native(options)
			remember(ctx)
			return ctx
		}
		Wrapped.prototype = Native.prototype
		window.AudioContext = Wrapped
		if (window.webkitAudioContext) {
			window.webkitAudioContext = Wrapped
		}
	}

	window.__ntsRoute = function (label) {
		state.sink = label
		// Anything attached to the document as well, for a player that does keep
		// its element there.
		var attached = document.querySelectorAll("audio, video")
		for (var i = 0; i < attached.length; i++) {
			if (state.targets.indexOf(attached[i]) < 0) {
				state.targets.push(attached[i])
			}
		}
		for (var j = 0; j < state.targets.length; j++) {
			apply(state.targets[j])
		}
		return state.targets.length
	}

	return "hooked"
})()`

/** Installs the hook. Safe to call repeatedly: the hook returns early. */
export async function hookFrame(frame: WebFrameMain): Promise<void> {
	try {
		await frame.executeJavaScript(HOOK)
	} catch (err) {
		// A frame can navigate or go away mid-call, which is not worth reporting.
	}
}

/**
 * Points every player frame at the named device, or at the system default when
 * the label is empty.
 */
export async function routeFrames(
	contents: WebContents,
	label: string,
): Promise<void> {
	if (contents.isDestroyed()) {
		return
	}

	const main = contents.mainFrame
	for (const frame of main.framesInSubtree) {
		if (frame === main || !isPlayerFrame(frame)) {
			continue
		}
		await hookFrame(frame)
		try {
			await frame.executeJavaScript(`window.__ntsRoute(${JSON.stringify(label)})`)
		} catch (err) {
			// As above: the frame may not have survived the round trip.
		}
	}
}

export { isPlayerFrame }
