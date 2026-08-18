import { net } from "electron"

/**
 * What the server says about a stream, and what its bytes actually contain.
 *
 * `reported` is taken from the ICY response headers, which are simply claims.
 * `measured` is decoded from the audio frames themselves, so it cannot be
 * wrong about the codec, bitrate, sample rate or channel mode.
 */
export type StreamProbe = {
	reported: {
		bitrate: number | null
		sampleRate: number | null
		contentType: string
		station: string
	}
	measured: {
		codec: string
		bitrate: number | null
		sampleRate: number | null
		channelMode: string
		frames: number
	} | null
	edge: string
}

// MPEG audio frame header tables, indexed as the bits appear in the header.
const MPEG_VERSION = ["2.5", null, "2", "1"] as const
const LAYER = [null, "III", "II", "I"] as const

// [version group][bitrate index], kbps. Version group 0 = MPEG-1.
const BITRATES_V1_L3 = [
	null,
	32,
	40,
	48,
	56,
	64,
	80,
	96,
	112,
	128,
	160,
	192,
	224,
	256,
	320,
	null,
]
const BITRATES_V2_L3 = [
	null,
	8,
	16,
	24,
	32,
	40,
	48,
	56,
	64,
	80,
	96,
	112,
	128,
	144,
	160,
	null,
]

const SAMPLE_RATES: Record<string, number[]> = {
	"1": [44100, 48000, 32000],
	"2": [22050, 24000, 16000],
	"2.5": [11025, 12000, 8000],
}

const CHANNEL_MODES = ["Stereo", "Joint stereo", "Dual channel", "Mono"]

type Frame = {
	codec: string
	bitrate: number | null
	sampleRate: number | null
	channelMode: string
	length: number
}

function parseFrame(buf: Buffer, i: number): Frame | null {
	// Frame sync: eleven set bits.
	if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
		return null
	}

	const version = MPEG_VERSION[(buf[i + 1] >> 3) & 0x03]
	const layer = LAYER[(buf[i + 1] >> 1) & 0x03]
	if (!version || !layer) {
		return null
	}

	const bitrateIndex = (buf[i + 2] >> 4) & 0x0f
	const sampleIndex = (buf[i + 2] >> 2) & 0x03
	if (bitrateIndex === 0 || bitrateIndex === 0x0f || sampleIndex === 0x03) {
		return null
	}

	const table = version === "1" ? BITRATES_V1_L3 : BITRATES_V2_L3
	const bitrate = table[bitrateIndex]
	const sampleRate = SAMPLE_RATES[version]?.[sampleIndex] ?? null
	if (!bitrate || !sampleRate) {
		return null
	}

	const padding = (buf[i + 2] >> 1) & 0x01
	const channelMode = CHANNEL_MODES[(buf[i + 3] >> 6) & 0x03]

	// Layer III frames hold 1152 samples, so this is where the next one starts.
	const length = Math.floor((144 * bitrate * 1000) / sampleRate) + padding

	return {
		codec: `MPEG-${version} Layer ${layer}`,
		bitrate,
		sampleRate,
		channelMode,
		length,
	}
}

/**
 * Walks the buffer confirming that consecutive frames line up. A single header
 * can appear by chance inside audio data; a chain of them cannot.
 */
function analyse(buf: Buffer): StreamProbe["measured"] {
	for (let start = 0; start < buf.length - 4; start++) {
		const first = parseFrame(buf, start)
		if (!first) {
			continue
		}

		let offset = start
		let frames = 0
		let current: Frame | null = first

		while (current && offset + current.length + 4 < buf.length) {
			frames += 1
			offset += current.length
			current = parseFrame(buf, offset)
		}

		// Four in a row is far beyond coincidence.
		if (frames >= 4) {
			return {
				codec: first.codec,
				bitrate: first.bitrate,
				sampleRate: first.sampleRate,
				channelMode: first.channelMode,
				frames,
			}
		}
	}

	return null
}

function header(value: string | string[] | undefined): string {
	return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

function numeric(value: string | string[] | undefined): number | null {
	const parsed = Number(header(value))
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const SAMPLE_BYTES = 64 * 1024
const TIMEOUT = 10_000

/**
 * Reads a small sample of a stream and reports both what the headers claim and
 * what the audio frames prove. Runs in the main process: the relay answers its
 * redirect without CORS headers, so the renderer can neither read the headers
 * nor touch the bytes.
 */
export function probeStream(url: string): Promise<StreamProbe | null> {
	return new Promise(function (resolve) {
		let edge = url
		let settled = false
		const chunks: Buffer[] = []
		let total = 0

		const request = net.request({ url, method: "GET" })
		request.setHeader("Icy-MetaData", "0")

		function finish(probe: StreamProbe | null) {
			if (settled) {
				return
			}
			settled = true
			clearTimeout(timer)
			try {
				request.abort()
			} catch {}
			resolve(probe)
		}

		const timer = setTimeout(() => finish(null), TIMEOUT)

		request.on("redirect", function (_status: number, _method: string, to: string) {
			edge = to
		})

		request.on("response", function (response) {
			const headers = response.headers
			const reported = {
				bitrate: numeric(headers["icy-br"]),
				sampleRate: numeric(headers["icy-samplerate"]),
				contentType: header(headers["content-type"]),
				station: header(headers["icy-name"]),
			}

			response.on("data", function (chunk: Buffer) {
				if (settled) {
					return
				}
				chunks.push(chunk)
				total += chunk.length
				if (total >= SAMPLE_BYTES) {
					const buf = Buffer.concat(chunks)
					finish({
						reported,
						measured: analyse(buf),
						edge: new URL(edge).host,
					})
				}
			})

			response.on("end", function () {
				const buf = Buffer.concat(chunks)
				finish({ reported, measured: analyse(buf), edge: new URL(edge).host })
			})
		})

		request.on("error", () => finish(null))
		request.end()
	})
}
