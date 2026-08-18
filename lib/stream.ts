export type Stream = 1 | 2

export function streamToPathname(stream: 1 | 2): string {
	if (stream === 1) {
		return "/stream"
	}
	if (stream === 2) {
		return "/stream2"
	}
	return "unknown"
}

export function pathnameToStream(pathname: string): 1 | 2 | null {
	if (pathname === "/stream") {
		return 1
	}
	if (pathname === "/stream2") {
		return 2
	}
	return null
}

// The direct Icecast-style connection. The browser keeps only a couple of
// seconds buffered on these, so any network hiccup longer than that is audible.
export const streams = {
	1: "https://stream-relay-geo.ntslive.net/stream?client=NTSWebApp",
	2: "https://stream-relay-geo.ntslive.net/stream2?client=NTSWebApp",
}

// The same audio delivered as HLS: 12 second MP3 segments at the same 256 kbps.
// Played through hls.js this holds tens of seconds of buffer instead of two, so
// a dropped connection or a stalled segment is absorbed instead of heard.
export const hlsStreams = {
	1: "https://streams.radiomast.io/nts1/hls.m3u8",
	2: "https://streams.radiomast.io/nts2/hls.m3u8",
}
