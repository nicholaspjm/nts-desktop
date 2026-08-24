import fetch from "isomorphic-fetch"

import { type Tag, tags } from "~/lib/tags"

/**
 * A track, deliberately without its timing.
 *
 * The API hands back offset and duration for every track without asking who is
 * requesting them, but the NTS site shows those only to Supporters: the episode
 * page carries a promo offering to "unlock timestamps" for them. The artist and
 * title are public and appear in the page a logged out visitor is served.
 *
 * So the timings are not parsed here at all. Holding data the app has decided
 * not to display is how it ends up displayed later by accident.
 */
export type Track = {
	artist: string
	title: string
}

export type SourceType = "mixcloud" | "soundcloud"

export type ShowInfo = {
	name: string
	date: Date
	tracklist: Track[]
	location: string
	image: string
	genres: Tag[]
	moods: Tag[]
	source: {
		url: string
		source: SourceType
	}
}

type Content = {
	name: string
	location_long: string
	media: {
		background_large: string
	}
	mixcloud: string
	audio_sources: {
		url: string
		source: SourceType
	}[]
	broadcast: string
	genres: { id?: string; value?: string }[]
	moods: { id?: string; value?: string }[]
	embeds: {
		tracklist: {
			results: { artist?: string; title?: string }[]
		}
	}
}

export async function show(url: string): Promise<ShowInfo> {
	const api = url.replace(
		/^(https?:\/\/)?(www\.)?nts\.live\//,
		"https://www.nts.live/api/v2/",
	)
	const resp = await fetch(api, { cache: "no-cache" })
	const content = (await resp.json()) as Content

	const {
		name,
		location_long,
		media: { background_large },
		audio_sources,
		broadcast,
		embeds: {
			tracklist: { results },
		},
	} = content

	return {
		name,
		location: location_long,
		image: background_large,
		date: new Date(broadcast),
		// Narrowed here rather than passed through, so the timings the API
		// volunteers never cross into the app at all.
		tracklist: results.map((track) => ({
			artist: track.artist ?? "",
			title: track.title ?? "",
		})),
		genres: tags(content.genres),
		moods: tags(content.moods),
		source: audio_sources[0],
	}
}
