import { useCallback, useEffect, useRef, useState } from "react"
import { useEvent } from "./use-event"

import { artwork } from "~/lib/media"

export type ChannelInfo = {
	now: ShowInfo
	next: ShowInfo | null
	// now + next..next17, so the full ~18 slot schedule the API already returns
	// on every poll and which used to be thrown away.
	schedule: ShowInfo[]
}

export type ShowInfo = {
	name: string
	starts: Date
	ends: Date
	location: string
	image: string
	description: string
	genres: string[]
	moods: string[]
	showAlias: string
	episodeAlias: string
}

export type Info = {
	channel1: ChannelInfo
	channel2: ChannelInfo
}
export type InfoState = {
	loading: boolean
	data: Info | null
	error: Error | null
}

type LiveOptions = {
	signal?: AbortSignal
}

// now, next, next2 … next17
const SLOTS = [
	"now",
	"next",
	...Array.from({ length: 16 }, (_, i) => `next${i + 2}`),
]

export async function live(options: LiveOptions): Promise<Info> {
	const resp = await fetch("https://www.nts.live/api/v2/live", {
		cache: "no-cache",
		signal: options.signal,
	})

	const content = await resp.json()

	return {
		channel1: channel(content.results[0]),
		channel2: channel(content.results[1]),
	}
}

type ChannelData = Record<string, ShowData | undefined>

function channel(data: ChannelData): ChannelInfo {
	const schedule: ShowInfo[] = []
	for (const slot of SLOTS) {
		const entry = data[slot]
		if (!entry) {
			continue
		}
		try {
			schedule.push(simplify(entry))
		} catch {
			// The API is undocumented and occasionally has a slot with missing
			// embeds. Skip it rather than blanking the whole channel.
		}
	}

	if (schedule.length === 0) {
		throw new Error("no shows in channel schedule")
	}

	return result({
		now: schedule[0],
		next: schedule[1] ?? null,
		schedule,
	})
}

function result(info: ChannelInfo): ChannelInfo {
	if (info.now.ends.getTime() > Date.now()) {
		return info
	}

	if (!info.next) {
		return info
	}

	return {
		now: info.next,
		next: info.schedule[2] ?? null,
		schedule: info.schedule.slice(1),
	}
}

type Tag = { value?: string }

// Only `now` and `next` carry embedded details. The later slots (next2 … next17)
// are real schedule entries but arrive with just a title, a start and an end,
// and an empty `embeds` object.
type ShowData = {
	broadcast_title?: string
	start_timestamp: string
	end_timestamp: string
	embeds?: {
		details?: {
			name?: string
			description?: string
			location_long?: string
			show_alias?: string
			episode_alias?: string
			genres?: Tag[]
			moods?: Tag[]
			media?: {
				background_large?: string
			}
		}
	}
}

function tags(list: Tag[] | undefined): string[] {
	if (!list) {
		return []
	}
	return list.map((t) => t.value).filter((v): v is string => Boolean(v))
}

function simplify(data: ShowData): ShowInfo {
	const details = data.embeds?.details

	const name = details?.name ?? data.broadcast_title
	if (!name) {
		throw new Error("show has no title")
	}

	return {
		name,
		location: details?.location_long ?? "",
		// The home card is 419px wide, so 628px on a 1.5x display. background_large
		// is 1600x1600 and 135KB, which is most of why the home page artwork was
		// slow to appear. 800 covers it, at 55KB. The same URL is reused by the
		// now playing bar, the full screen art and the mini player, so one
		// download serves all four rather than each sizing itself perfectly and
		// fetching separately.
		image: artwork(details?.media?.background_large, 800),
		description: details?.description ?? "",
		genres: tags(details?.genres),
		moods: tags(details?.moods),
		showAlias: details?.show_alias ?? "",
		episodeAlias: details?.episode_alias ?? "",
		starts: new Date(data.start_timestamp),
		ends: new Date(data.end_timestamp),
	}
}

type Options = {
	skip?: boolean
}

export function useLiveInfo(options: Options): InfoState {
	const [state, setState] = useState<InfoState>({
		loading: true,
		data: null,
		error: null,
	})
	const abort = useRef<AbortController | null>(null)

	const load = useCallback(async function () {
		abort.current?.abort()
		// Held locally rather than read back off the ref. Both checks below used
		// to test abort.current, which by then is whichever controller the NEWEST
		// call installed, not this one. So a superseded load saw "not aborted",
		// fell through, and wrote its own outcome over a load still in flight:
		// the splash would disappear onto an empty live view and an AbortError
		// would be recorded although nothing had actually failed. Two loads at
		// once is routine, since opening the window starts one.
		const controller = new AbortController()
		abort.current = controller

		setState((state) => ({ ...state, loading: true, error: null }))

		try {
			const data = await live({ signal: controller.signal })
			if (controller.signal.aborted) {
				return
			}
			setState({ loading: false, data, error: null })
		} catch (err) {
			if (controller.signal.aborted) {
				return
			}
			// Keep whatever we last had on screen rather than blanking the app.
			setState((state) => ({
				...state,
				loading: false,
				error: err instanceof Error ? err : new Error(String(err)),
			}))
		}
	}, [])

	useEffect(
		function () {
			if (options.skip) {
				return
			}

			load()
		},
		[load, options.skip],
	)

	const next = useCallback(
		function () {
			setState(function (state) {
				if (!state.data) {
					return state
				}
				return {
					...state,
					data: {
						channel1: result(state.data.channel1),
						channel2: result(state.data.channel2),
					},
				}
			})
			load()
		},
		[load],
	)

	useEffect(
		function () {
			if (options.skip) {
				return
			}
			const now = Date.now()
			const ch1 =
				(state.data?.channel1.now.ends.getTime() ?? Number.POSITIVE_INFINITY) - now
			const ch2 =
				(state.data?.channel2.now.ends.getTime() ?? Number.POSITIVE_INFINITY) - now
			const soonest = Math.min(ch1, ch2)
			if (!Number.isFinite(soonest)) {
				return
			}

			if (soonest < 0) {
				if (!state.data && !state.loading) {
					next()
				}
				return
			}

			const t = setTimeout(next, soonest + 500)
			return () => clearTimeout(t)
		},
		[next, state.data, state.loading, options.skip],
	)

	useEvent("open", async function () {
		load()
	})

	return {
		loading: state.loading,
		data: state.data,
		error: state.error,
	}
}
