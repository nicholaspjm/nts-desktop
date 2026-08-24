/**
 * Canonical URLs for NTS artwork.
 *
 * NTS serves the same picture from media, media2 and media3, and which host you
 * get back depends on which endpoint answered rather than on anything about the
 * image. The bytes are identical, verified by checksum across all three. The URL
 * is the cache key though, so the same artwork arriving from two endpoints is
 * downloaded twice: the search result hands back media.ntslive.co.uk and the
 * show endpoint hands back media2.ntslive.co.uk for the very same file.
 *
 * Pinning the host is what lets the detail view reuse the picture the card it
 * was opened from has already loaded, instead of fetching it again.
 *
 * The sizes are the ones NTS publishes. Everything is square and the path is
 * otherwise identical, so a size can be swapped in place. Artwork is cached for
 * a year (max-age=31536000, public), so this is worth getting right once.
 */

const HOST = /^https:\/\/media\d*\.ntslive\.co\.uk\//
const CANONICAL = "https://media.ntslive.co.uk/"
const SIZE = /\/resize\/\d+x\d+\//

/** The square variants NTS publishes, in pixels. */
export type ImageSize = 100 | 200 | 400 | 800 | 1600

/**
 * Rewrites artwork to the canonical host, and optionally to a given size.
 *
 * Anything that is not NTS artwork is handed back untouched, so this is safe to
 * apply to a field that might hold something else or nothing at all.
 */
export function artwork(url: string | undefined | null, size?: ImageSize): string {
	if (!url || !HOST.test(url)) {
		return url ?? ""
	}

	const pinned = url.replace(HOST, CANONICAL)
	if (!size) {
		return pinned
	}

	return pinned.replace(SIZE, `/resize/${size}x${size}/`)
}
