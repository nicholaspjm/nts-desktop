import { net } from "electron"

export type UpdateCheck = {
	current: string
	latest: string | null
	newer: boolean
	url: string
}

// Not the API. api.github.com allows 60 unauthenticated requests an hour per
// address, which is plenty for one check at launch but not for everyone sharing
// an office or a carrier NAT. The releases page redirects to the tagged version,
// so the redirect target alone gives the number, with no quota involved.
const LATEST = "https://github.com/nicholaspjm/nts-desktop/releases/latest"

/** Compares dotted versions numerically, so 0.10.0 beats 0.9.0. */
function isNewer(latest: string, current: string): boolean {
	const a = latest.replace(/^v/, "").split(".").map(Number)
	const b = current.replace(/^v/, "").split(".").map(Number)
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0
		const y = b[i] ?? 0
		if (x !== y) {
			return x > y
		}
	}
	return false
}

/**
 * Asks GitHub what the latest release is.
 *
 * Runs in the main process so the renderer's CSP does not need to allow
 * api.github.com, and so a failure here is silent rather than a console error
 * in front of the user. Nothing is downloaded or installed: it only reports.
 */
export function checkForUpdate(current: string): Promise<UpdateCheck> {
	return new Promise(function (resolve) {
		const fallback: UpdateCheck = {
			current,
			latest: null,
			newer: false,
			url: LATEST,
		}

		let settled = false
		function finish(check: UpdateCheck) {
			if (!settled) {
				settled = true
				clearTimeout(timer)
				resolve(check)
			}
		}

		function fromURL(url: string): UpdateCheck | null {
			const match = /\/releases\/tag\/v?([0-9]+(?:\.[0-9]+)*)/.exec(url)
			if (!match) {
				return null
			}
			const latest = match[1]
			return { current, latest, newer: isNewer(latest, current), url: LATEST }
		}

		const request = net.request({ url: LATEST, method: "HEAD" })
		request.setHeader("User-Agent", "NTS-Desktop")

		const timer = setTimeout(function () {
			try {
				request.abort()
			} catch {}
			finish(fallback)
		}, 8000)

		// The tag is in the redirect target, so read it there.
		request.on("redirect", function (_status: number, _method: string, to: string) {
			const found = fromURL(to)
			if (found) {
				try {
					request.abort()
				} catch {}
				finish(found)
			}
		})

		request.on("response", function (response) {
			response.on("data", () => {})
			response.on("end", function () {
				finish(fallback)
			})
		})

		request.on("error", () => finish(fallback))
		request.end()
	})
}
