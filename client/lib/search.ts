import { useEffect, useRef, useState } from "react"

export type SearchResult = {
	title: string
	// Full nts.live URL, ready for the archive opener.
	url: string
	date: string
	location: string
	image: string
}

export type SortOrder = "relevance" | "newest" | "oldest"

export type SearchState = {
	results: SearchResult[]
	loading: boolean
	error: boolean
}

type RawResult = {
	title?: string
	local_date?: string
	location?: string
	article?: { path?: string }
	image?: Record<string, string>
}

function simplify(raw: RawResult): SearchResult | null {
	const path = raw.article?.path
	if (!path || !path.startsWith("/shows/")) {
		return null
	}

	const image = raw.image ?? {}
	return {
		title: raw.title ?? "Untitled",
		url: `https://www.nts.live${path}`,
		date: raw.local_date ?? "",
		location: raw.location ?? "",
		image: image.medium_large ?? image.medium ?? image.large ?? image.small ?? "",
	}
}

const DEBOUNCE = 350

/**
 * Searches the NTS archive.
 *
 * The endpoint is undocumented but returns JSON and allows cross-origin reads,
 * so it can be called straight from the renderer, unlike the audio streams.
 */
export function useSearch(query: string): SearchState {
	const [state, setState] = useState<SearchState>({
		results: [],
		loading: false,
		error: false,
	})
	const request = useRef(0)

	useEffect(
		function () {
			const trimmed = query.trim()
			if (trimmed.length < 2) {
				setState({ results: [], loading: false, error: false })
				return
			}

			const id = request.current + 1
			request.current = id
			setState((s) => ({ ...s, loading: true, error: false }))

			const controller = new AbortController()
			// Don't fire a request per keystroke.
			const timer = setTimeout(function () {
				// `version=2` and an explicit `types[]` are both required. Without
				// them the endpoint ignores the query entirely and hands back a
				// recent-episodes feed, which would make this box quietly lie.
				const query = encodeURIComponent(trimmed)
				const url = `https://www.nts.live/api/v2/search?q=${query}&version=2&offset=0&limit=24&types%5B%5D=episode`

				fetch(url, { signal: controller.signal })
					.then((resp) => resp.json())
					.then(function (body) {
						if (request.current !== id) {
							return
						}
						const results = ((body.results ?? []) as RawResult[])
							.map(simplify)
							.filter((r): r is SearchResult => r !== null)
						setState({ results, loading: false, error: false })
					})
					.catch(function () {
						if (request.current !== id || controller.signal.aborted) {
							return
						}
						setState({ results: [], loading: false, error: true })
					})
			}, DEBOUNCE)

			return function () {
				clearTimeout(timer)
				controller.abort()
			}
		},
		[query],
	)

	return state
}

/**
 * Sorts results client side.
 *
 * The endpoint accepts no sort parameter: sort, order and every variant are
 * ignored and return identical results. So this reorders the page already
 * fetched, not the whole archive.
 */
export function sortResults(
	results: SearchResult[],
	order: SortOrder,
): SearchResult[] {
	if (order === "relevance") {
		return results
	}

	const withTime = results.map(function (result) {
		const time = Date.parse(result.date)
		return { result, time: Number.isNaN(time) ? 0 : time }
	})

	withTime.sort((a, b) => (order === "newest" ? b.time - a.time : a.time - b.time))
	return withTime.map((x) => x.result)
}

/** True for anything that looks like an NTS archive show link. */
export function isShowURL(value: string): boolean {
	return /^https?:\/\/(www\.)?nts\.live\/shows\/.+/.test(value.trim())
}
