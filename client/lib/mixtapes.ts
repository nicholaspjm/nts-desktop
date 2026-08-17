import { useEffect, useState } from "react"

// NTS "Infinite Mixtapes": continuous music-only streams built from resident and
// guest shows. There are ~16 of them and the app previously had no support at
// all, despite them being the same kind of stream as the live channels.
export type Mixtape = {
	alias: string
	title: string
	subtitle: string
	description: string
	image: string
	icon: string
	stream: string
}

export type MixtapesState = {
	loading: boolean
	data: Mixtape[]
	error: Error | null
}

type MixtapeData = {
	mixtape_alias: string
	title: string
	subtitle: string
	description: string
	audio_stream_endpoint: string
	media?: {
		picture_medium_large?: string
		picture_large?: string
		picture_medium?: string
		picture_small?: string
		icon_white?: string
	}
}

function simplify(data: MixtapeData): Mixtape {
	const media = data.media ?? {}
	return {
		alias: data.mixtape_alias,
		title: data.title,
		subtitle: data.subtitle,
		description: data.description,
		image:
			media.picture_medium_large ??
			media.picture_large ??
			media.picture_medium ??
			media.picture_small ??
			"",
		icon: media.icon_white ?? "",
		stream: data.audio_stream_endpoint,
	}
}

export async function mixtapes(signal?: AbortSignal): Promise<Mixtape[]> {
	const resp = await fetch("https://www.nts.live/api/v2/mixtapes", { signal })
	const content = await resp.json()
	return (content.results ?? []).map(simplify).filter((m: Mixtape) => m.stream)
}

export function useMixtapes(): MixtapesState {
	const [state, setState] = useState<MixtapesState>({
		loading: true,
		data: [],
		error: null,
	})

	useEffect(function () {
		const controller = new AbortController()

		mixtapes(controller.signal).then(
			function (data) {
				setState({ loading: false, data, error: null })
			},
			function (err) {
				if (controller.signal.aborted) {
					return
				}
				setState({ loading: false, data: [], error: err })
			},
		)

		return function () {
			controller.abort()
		}
	}, [])

	return state
}
