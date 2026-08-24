import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { artwork } from "~/lib/media"
import { type Tag, tags } from "~/lib/tags"

/**
 * Browsing the NTS archive by mood and genre.
 *
 * The endpoints are undocumented and were found by reading the site's own
 * bundle, but they return JSON and allow cross-origin reads, so they can be
 * called straight from the renderer exactly as the search does.
 *
 * The filters were verified against a control request carrying a deliberately
 * nonsense parameter. That matters here: this API silently ignores parameters
 * it does not recognise and returns byte-identical results, so a filter that
 * looks accepted can be doing nothing at all. The control returned 87,594
 * episodes either way, while moods[]=sedative returned 2,208, which is what
 * proves these are real.
 */

const API = "https://www.nts.live/api/v2"

// The server caps a page at twelve however much is asked for, so asking for
// more just wastes the request. Verified: limit=100 returns twelve.
export const PAGE_SIZE = 12

export type { Tag }

export type Mood = Tag & {
	description: string
	image: string
}

export type Genre = Tag & {
	subgenres: Tag[]
}

export type Taxonomy = {
	moods: Mood[]
	genres: Genre[]
	loading: boolean
	error: boolean
}

export type ExploreShow = {
	title: string
	// Full nts.live URL, ready for the archive opener the app already has.
	url: string
	date: string
	location: string
	image: string
	genres: Tag[]
	moods: Tag[]
}

export type ExploreFilters = {
	// One mood at most. Two moods is an AND, and since the moods are close to
	// opposites in places it usually returns nothing at all: sedative plus
	// nosebleed is zero results, which reads as a broken filter rather than an
	// honest empty set.
	mood: string | null
	// Several genres can be on at once, but they AND rather than OR: verified as
	// housetechno 27,146 and ukdance 5,201 giving 2,145 together, which is fewer
	// than either. So picking two narrows to the overlap rather than widening,
	// and the UI has to show the count or it reads as a broken filter.
	genres: string[]
}

export type ExploreState = {
	shows: ExploreShow[]
	total: number
	loading: boolean
	loadingMore: boolean
	error: boolean
	hasMore: boolean
	loadMore: () => void
}

type RawTag = { id?: string; name?: string }

type RawShow = {
	title?: string
	local_date?: string
	location?: string
	article?: { path?: string }
	image?: Record<string, string>
	genres?: RawTag[]
	moods?: RawTag[]
}

function simplify(raw: RawShow): ExploreShow | null {
	const path = raw.article?.path
	// Anything that is not a show episode cannot be opened by the archive view,
	// so it is dropped rather than rendered as a card that goes nowhere.
	if (!path || !path.startsWith("/shows/")) {
		return null
	}

	const image = raw.image ?? {}
	return {
		title: raw.title ?? "Untitled",
		url: `https://www.nts.live${path}`,
		// Already formatted by the API, e.g. "19 Aug 2026".
		date: raw.local_date ?? "",
		location: raw.location ?? "",
		// Tiles are 200px square, so 300px on a 1.5x display. medium_large is
		// 800x800 and 55KB each, and a grid holds twelve of them.
		image: artwork(
			image.medium_large ?? image.medium ?? image.large ?? image.small,
			400,
		),
		genres: tags(raw.genres),
		moods: tags(raw.moods),
	}
}

/**
 * The mood and genre lists NTS itself offers.
 *
 * Fetched rather than hard-coded so the app follows NTS when they change them.
 * Ten moods and twenty genres, the genres carrying 442 subgenres between them.
 */
export function useTaxonomy(enabled: boolean): Taxonomy {
	const [state, setState] = useState<Taxonomy>({
		moods: [],
		genres: [],
		loading: true,
		error: false,
	})

	useEffect(
		function () {
			// Nothing is asked of NTS until someone opens the view. The app promises
			// to be light on their servers, and three requests at every launch for
			// a screen most sessions never visit is not that.
			if (!enabled) {
				return
			}

			let cancelled = false

			Promise.all([
				fetch(`${API}/moods`).then((r) => r.json()),
				fetch(`${API}/genres`).then((r) => r.json()),
			])
				.then(function ([moods, genres]) {
					if (cancelled) {
						return
					}
					setState({
						moods: (moods?.results ?? [])
							.filter((m: RawTag) => m.id && m.name)
							.map(
								(
									m: RawTag & {
										description?: string
										image?: Record<string, string>
									},
								) => ({
									id: m.id as string,
									name: m.name as string,
									description: m.description ?? "",
									image: m.image?.medium ?? m.image?.large ?? "",
								}),
							),
						genres: (genres?.results ?? [])
							.filter((g: RawTag) => g.id && g.name)
							.map((g: RawTag & { subgenres?: RawTag[] }) => ({
								id: g.id as string,
								name: g.name as string,
								subgenres: tags(g.subgenres),
							})),
						loading: false,
						error: false,
					})
				})
				.catch(function () {
					if (!cancelled) {
						setState({ moods: [], genres: [], loading: true, error: true })
					}
				})

			return function () {
				cancelled = true
			}
		},
		[enabled],
	)

	return state
}

function url(filters: ExploreFilters, offset: number): string {
	const params = new URLSearchParams()
	// Both are required. Without them the query is ignored entirely and the
	// endpoint returns unrelated results that look plausible.
	params.set("version", "2")
	params.append("types[]", "episode")
	params.set("limit", String(PAGE_SIZE))
	if (offset > 0) {
		params.set("offset", String(offset))
	}
	if (filters.mood) {
		params.append("moods[]", filters.mood)
	}
	for (const genre of filters.genres) {
		params.append("genres[]", genre)
	}
	return `${API}/search/episodes?${params.toString()}`
}

/**
 * A page at a time of the archive, newest first.
 *
 * The ordering is the API's own and was confirmed against the returned dates
 * rather than assumed, so nothing here sorts.
 */
export function useExplore(filters: ExploreFilters, enabled: boolean): ExploreState {
	const [shows, setShows] = useState<ExploreShow[]>([])
	const [total, setTotal] = useState(0)
	const [loading, setLoading] = useState(true)
	const [loadingMore, setLoadingMore] = useState(false)
	const [error, setError] = useState(false)

	// Bumped on every request so a slow first page cannot overwrite a later one
	// after the filters have moved on.
	const request = useRef(0)
	const offset = useRef(0)

	// The filters arrive as a fresh object every render, so the hooks below watch
	// these two primitives instead. Depending on the object would refetch on
	// every render; depending on a derived key would make the dependency look
	// decorative, since nothing in the body would read it.
	const mood = filters.mood
	const genreKey = filters.genres.join(",")

	const fetchPage = useCallback(function (
		active: ExploreFilters,
		at: number,
		append: boolean,
	) {
		request.current += 1
		const id = request.current

		if (append) {
			setLoadingMore(true)
		} else {
			setLoading(true)
		}
		setError(false)

		fetch(url(active, at))
			.then((r) => r.json())
			.then(function (data) {
				if (id !== request.current) {
					return
				}
				const page = (data?.results ?? [])
					.map(simplify)
					.filter((s: ExploreShow | null): s is ExploreShow => s !== null)

				setShows((prev) => (append ? [...prev, ...page] : page))
				setTotal(data?.metadata?.resultset?.count ?? 0)
				offset.current = at + PAGE_SIZE
				setLoading(false)
				setLoadingMore(false)
			})
			.catch(function () {
				if (id !== request.current) {
					return
				}
				setError(true)
				setLoading(false)
				setLoadingMore(false)
			})
	}, [])

	// Rebuilt from the primitives so the dependency list says exactly what makes
	// this run again.
	const active: ExploreFilters = useMemo(
		function () {
			return { mood, genres: genreKey ? genreKey.split(",") : [] }
		},
		[mood, genreKey],
	)

	useEffect(
		function () {
			// Same reason as the taxonomy: nothing is requested until the view is
			// actually opened.
			if (!enabled) {
				return
			}
			offset.current = 0
			fetchPage(active, 0, false)
		},
		[active, enabled, fetchPage],
	)

	const loadMore = useCallback(
		function () {
			if (loading || loadingMore) {
				return
			}
			fetchPage(active, offset.current, true)
		},
		[active, fetchPage, loading, loadingMore],
	)

	return {
		shows,
		total,
		loading,
		loadingMore,
		error,
		hasMore: shows.length > 0 && shows.length < total,
		loadMore,
	}
}
