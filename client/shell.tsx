import classnames from "classnames"
import { useEffect, useRef, useState } from "react"

import logo from "../logos/nts.svg"

import type { ShowInfo as ArchiveShow } from "../app/show"
import type { CastDevice, CastStatus } from "./lib/cast"
import type { HistoryEntry, UpdateState } from "./lib/controls"
import type { ExploreFilters, ExploreState, Taxonomy } from "./lib/explore"
import type { ChannelInfo, Info, ShowInfo } from "./lib/live"
import type { Mixtape } from "./lib/mixtapes"
import type { AudioOutput } from "./lib/outputs"
import {
	type SearchState,
	type SortOrder,
	isShowURL,
	sortResults,
} from "./lib/search"
import { type StreamHealth, type StreamProbe, smooth } from "./lib/stream-info"
import { PlayButton } from "./play"
import type { PlayerStatus } from "./player"

import { artwork } from "~/lib/media"

import css from "./shell.module.css"

/**
 * The sharp banner with the small version painted underneath it.
 *
 * The detail banner is 847px wide, so it wants the 1600px image, and that takes
 * about two seconds to arrive. The tile that was clicked to get here has already
 * loaded the 400px version of the very same picture and it is still cached, so
 * putting that underneath fills the space immediately and the sharp one replaces
 * it the moment it lands. Earlier layers sit on top in CSS, so the large one is
 * listed first.
 */

/**
 * Full screen art at its sharpest, over whatever is already on screen.
 *
 * The live views deliberately fetch 800px artwork, which is right for a 419px
 * home card but soft blown up to nearly half the height of a large display. So
 * full screen asks for the 1600px one and lays the 800px one underneath, which
 * is already cached from the card that was on screen a moment ago. The result
 * fills immediately and sharpens rather than starting empty. When the source is
 * already 1600 both layers are the same URL, which costs nothing.
 */
function fullArtLayers(url: string): string {
	return `url(${artwork(url, 1600)}), url(${url})`
}

function artLayers(url: string): string {
	return `url(${url}), url(${artwork(url, 400)})`
}

// What the single audio pipeline is pointed at.
export type Source =
	| { kind: "channel"; id: 1 | 2 }
	| { kind: "mixtape"; alias: string }

export type View =
	| "live"
	| "explore"
	| "mixtapes"
	| "schedule"
	| "search"
	| "archive"
	| "history"

export type MenuAction =
	| "schedule"
	| "explore"
	| "reload"
	| "quit"
	| "report-problem"
	| "open-releases"
	| "open-logs"
export type WindowAction = "minimize" | "maximize" | "close" | "mini"

// Everything both the bottom bar and the full-screen view need to render.
export type NowPlaying = {
	title: string
	subtitle: string
	image: string
	description: string
	// TagLike rather than plain strings: the live API gives bare names while an
	// archive show carries the API's own id and name pairs, and both end up here.
	genres: TagLike[]
	moods: TagLike[]
	// Where the show is broadcast from. Empty for mixtapes and when idle. The
	// mini player prints it on its own, the way the original did.
	location: string
	// Empty for mixtapes, which have no show page.
	showAlias: string
	starts: Date | null
	ends: Date | null
}

export function sameSource(a: Source | null, b: Source | null): boolean {
	if (!a || !b) {
		return false
	}
	if (a.kind === "channel" && b.kind === "channel") {
		return a.id === b.id
	}
	if (a.kind === "mixtape" && b.kind === "mixtape") {
		return a.alias === b.alias
	}
	return false
}

// macOS draws its own traffic lights into the inset title bar, so the app must
// not draw a second set of window controls there.
const isMac = navigator.userAgent.includes("Mac OS X")

function time(date: Date): string {
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

type TitleBarProps = {
	onMini: () => void
	onAction: (action: MenuAction) => void
	onWindow: (action: WindowAction) => void
	update: UpdateState | null
	// Where the sound comes out. Both live up here now: the bottom bar was
	// carrying two controls that are set once and then left alone, which is
	// what a menu is for.
	outputs: AudioOutput[]
	outputDevice: string
	onOutputDevice: (id: string) => void
	onRefreshOutputs: () => void
	castDevices: CastDevice[]
	castTarget: string | null
	castingNow: boolean
	canCast: boolean
	castStatus: CastStatus
	castError?: string
	onOpenCast: () => void
	onCloseCast: () => void
	onCast: (deviceId: string) => void
	onStopCast: () => void
	onRescanCast: () => void
}

export function TitleBar(props: TitleBarProps) {
	const {
		onAction,
		onWindow,
		onMini,
		update,
		outputs,
		outputDevice,
		onOutputDevice,
		onRefreshOutputs,
		castDevices,
		castTarget,
		castingNow,
		canCast,
		castStatus,
		castError,
		onOpenCast,
		onCloseCast,
		onCast,
		onStopCast,
		onRescanCast,
	} = props
	const [open, setOpen] = useState(false)
	const menu = useRef<HTMLDivElement | null>(null)

	useEffect(
		function () {
			if (!open) {
				return
			}

			function dismiss(evt: MouseEvent) {
				if (menu.current?.contains(evt.target as Node)) {
					return
				}
				setOpen(false)
			}

			function onKey(evt: KeyboardEvent) {
				if (evt.key === "Escape") {
					setOpen(false)
				}
			}

			document.addEventListener("mousedown", dismiss)
			document.addEventListener("keydown", onKey)
			return function () {
				document.removeEventListener("mousedown", dismiss)
				document.removeEventListener("keydown", onKey)
			}
		},
		[open],
	)

	const items: Array<{ id: MenuAction; label: string }> = [
		{ id: "explore", label: "Explore on NTS" },
		{ id: "schedule", label: "Full schedule" },
		{ id: "report-problem", label: "Report a problem" },
		{ id: "open-logs", label: "Show crash log" },
		{ id: "reload", label: "Reload" },
		{ id: "quit", label: "Quit" },
	]

	if (update?.newer) {
		items.unshift({
			id: "open-releases",
			label: `Update available: ${update.latest}`,
		})
	}

	return (
		<header className={classnames(css.titlebar, { [css.titlebarMac]: isMac })}>
			<div className={css.menuWrap} ref={menu}>
				<button
					type="button"
					className={css.iconButton}
					aria-label="Menu"
					onClick={() => setOpen((x) => !x)}
				>
					<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="3" cy="8" r="1.4" fill="currentColor" />
						<circle cx="8" cy="8" r="1.4" fill="currentColor" />
						<circle cx="13" cy="8" r="1.4" fill="currentColor" />
					</svg>
					{update?.newer ? <span className={css.updateDot} /> : null}
				</button>

				{open ? (
					<div className={css.menu}>
						{/* Output first, because it is the only thing here that changes
						    what you hear. Devices are listed rather than put in a select,
						    so the menu is one kind of thing to click all the way down. */}
						<div className={css.menuHeading}>
							Output
							<button
								type="button"
								className={css.menuRefresh}
								onClick={onRefreshOutputs}
								title="Look for audio devices again"
							>
								Refresh
							</button>
						</div>

						<button
							type="button"
							className={classnames(css.menuItem, {
								[css.menuItemOn]: outputDevice === "",
							})}
							onClick={() => {
								setOpen(false)
								onOutputDevice("")
							}}
						>
							System default
						</button>

						{outputs
							.filter((o) => o.id !== "default")
							.map(function (output) {
								return (
									<button
										key={output.id}
										type="button"
										className={classnames(css.menuItem, {
											[css.menuItemOn]: outputDevice === output.id,
										})}
										onClick={() => {
											setOpen(false)
											onOutputDevice(output.id)
										}}
									>
										{output.label}
									</button>
								)
							})}

						<div className={css.menuRule} />

						{items.map(function (item) {
							return (
								<button
									key={item.id}
									type="button"
									className={classnames(css.menuItem, {
										[css.menuItemHighlight]: item.id === "open-releases",
									})}
									onClick={() => {
										setOpen(false)
										onAction(item.id)
									}}
								>
									{item.label}
								</button>
							)
						})}
					</div>
				) : null}
			</div>

			<button
				type="button"
				className={css.iconButton}
				aria-label="Mini player"
				title="Mini player"
				onClick={onMini}
			>
				<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
					<rect
						x="1.5"
						y="3"
						width="13"
						height="10"
						stroke="currentColor"
						strokeWidth="1.2"
						fill="none"
					/>
					<rect x="7.5" y="7.5" width="5.5" height="4" fill="currentColor" />
				</svg>
			</button>

			<CastButton
				devices={castDevices}
				target={castTarget}
				casting={castingNow}
				canCast={canCast}
				onClose={onCloseCast}
				status={castStatus}
				error={castError}
				onOpen={onOpenCast}
				onSelect={onCast}
				onStop={onStopCast}
				onRescan={onRescanCast}
			/>

			<div className={css.drag} />

			<div className={classnames(css.windowControls, { [css.hidden]: isMac })}>
				<button
					type="button"
					className={css.iconButton}
					aria-label="Minimise"
					onClick={() => onWindow("minimize")}
				>
					<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
						<rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
					</svg>
				</button>
				<button
					type="button"
					className={css.iconButton}
					aria-label="Maximise"
					onClick={() => onWindow("maximize")}
				>
					<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
						<rect
							x="1.5"
							y="1.5"
							width="9"
							height="9"
							fill="none"
							stroke="currentColor"
						/>
					</svg>
				</button>
				<button
					type="button"
					className={classnames(css.iconButton, css.closeButton)}
					aria-label="Close"
					onClick={() => onWindow("close")}
				>
					<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
						<path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" fill="none" />
					</svg>
				</button>
			</div>
		</header>
	)
}

type NavProps = {
	view: View
	onView: (view: View) => void
	hasArchive: boolean
}

export function Nav(props: NavProps) {
	const { view, onView } = props

	const items: Array<{ id: View; label: string }> = [
		{ id: "live", label: "Live" },
		{ id: "explore", label: "Explore" },
		{ id: "mixtapes", label: "Mixtapes" },
		{ id: "schedule", label: "Schedule" },
		{ id: "search", label: "Search" },
		{ id: "history", label: "History" },
	]
	if (props.hasArchive) {
		items.push({ id: "archive", label: "Archive" })
	}

	return (
		<nav className={css.nav}>
			<div className={css.brand}>
				<img className={css.brandLogo} src={logo} alt="NTS" />
			</div>
			{items.map(function (item) {
				return (
					<button
						key={item.id}
						type="button"
						className={classnames(css.navItem, {
							[css.navItemActive]: view === item.id,
						})}
						onClick={() => onView(item.id)}
					>
						{item.label}
					</button>
				)
			})}
			<div className={css.navSpacer} />
		</nav>
	)
}

type ChannelCardProps = {
	channel: 1 | 2
	info: ChannelInfo | undefined
	active: boolean
	onPlay: () => void
	onStop: () => void
	onOpenNTS: () => void
}

/** A genre or mood, as either a bare name or the API's own id and name pair. */
export type TagLike = string | { id: string; name: string }

function tagKey(tag: TagLike): string {
	return typeof tag === "string" ? tag : tag.id
}

function tagName(tag: TagLike): string {
	return typeof tag === "string" ? tag : tag.name
}

type TagsProps = {
	genres?: TagLike[]
	moods?: TagLike[]
	// Genres run to a dozen on some shows, and a card is not the place for all
	// of them. Moods are capped separately because there are only ten in total
	// and an episode rarely carries more than two.
	maxGenres?: number
	maxMoods?: number
}

/**
 * Genres and moods, rendered the same way wherever they appear.
 *
 * The full screen view and the live card had grown their own copies of this,
 * with different caps and only one of them showing moods at all, so the same
 * show described itself differently depending on where you looked at it.

 *
 * Moods are dimmer than genres on purpose. A genre says what the music is and
 * is worth reading; a mood is NTS's own editorial framing and is closer to a
 * label than a fact.
 */
export function Tags(props: TagsProps) {
	const { genres = [], moods = [], maxGenres = 6, maxMoods = 3 } = props

	if (genres.length === 0 && moods.length === 0) {
		return null
	}

	return (
		<div className={css.tags}>
			{genres.slice(0, maxGenres).map((tag) => (
				<span key={tagKey(tag)} className={css.tag}>
					{tagName(tag)}
				</span>
			))}
			{moods.slice(0, maxMoods).map((tag) => (
				<span key={tagKey(tag)} className={classnames(css.tag, css.tagMood)}>
					{tagName(tag)}
				</span>
			))}
		</div>
	)
}

export function ChannelCard(props: ChannelCardProps) {
	const { channel, info, active, onPlay, onStop, onOpenNTS } = props
	const now = info?.now

	return (
		<article className={css.card}>
			<div
				className={css.cardArt}
				style={now?.image ? { backgroundImage: `url(${now.image})` } : undefined}
			>
				<span className={css.cardBadge}>{channel}</span>
			</div>
			<div className={css.cardBody}>
				<h2 className={css.cardTitle}>{now?.name ?? "Loading"}</h2>
				<div className={css.cardMeta}>
					{now ? (
						<>
							<span>
								{time(now.starts)} - {time(now.ends)}
							</span>
							{now.location ? <span>{now.location}</span> : null}
						</>
					) : null}
				</div>
				{now?.description ? <p className={css.cardDesc}>{now.description}</p> : null}
				{now ? (
					<Tags genres={now.genres} moods={now.moods} maxGenres={4} maxMoods={2} />
				) : null}
				<div className={css.cardActions}>
					<button
						type="button"
						className={classnames(css.button, { [css.buttonActive]: active })}
						onClick={active ? onStop : onPlay}
					>
						{active ? "Stop" : "Play"}
					</button>
					{now?.showAlias ? (
						<button type="button" className={css.button} onClick={onOpenNTS}>
							Open on NTS
						</button>
					) : null}
				</div>
				{info?.next ? (
					<div className={css.cardMeta}>
						Next: {info.next.name} at {time(info.next.starts)}
					</div>
				) : null}
			</div>
		</article>
	)
}

type LiveProps = {
	live: Info | null
	source: Source | null
	onPlay: (source: Source) => void
	onStop: () => void
	onOpenNTS: (channel: 1 | 2) => void
}

export function LiveView(props: LiveProps) {
	const { live, source, onPlay, onStop, onOpenNTS } = props

	return (
		<>
			<h1 className={css.heading}>Live now</h1>
			<div className={css.channels}>
				{([1, 2] as const).map(function (id) {
					const info = id === 1 ? live?.channel1 : live?.channel2
					return (
						<ChannelCard
							key={id}
							channel={id}
							info={info}
							active={sameSource(source, { kind: "channel", id })}
							onPlay={() => onPlay({ kind: "channel", id })}
							onStop={onStop}
							onOpenNTS={() => onOpenNTS(id)}
						/>
					)
				})}
			</div>
		</>
	)
}

type MixtapesProps = {
	mixtapes: Mixtape[]
	loading: boolean
	source: Source | null
	onSelect: (alias: string) => void
}

type ExploreProps = {
	taxonomy: Taxonomy
	filters: ExploreFilters
	onFilters: (filters: ExploreFilters) => void
	state: ExploreState
	onOpen: (url: string) => void
}

/**
 * Browsing the archive by mood and genre, the way the NTS site does.
 *
 * Filters narrow rather than widen: two genres means shows carrying both, and
 * two moods usually means nothing at all, which is why mood is single choice.
 * The result count is always on screen because of that. Without it, a
 * combination that legitimately matches four shows is indistinguishable from a
 * filter that has stopped working.
 *
 * A card opens the show through the same path the search results use, so
 * preview, playback and Open on NTS are the archive view's, not reimplemented.
 */
export function ExploreView(props: ExploreProps) {
	const { taxonomy, filters, onFilters, state, onOpen } = props

	function toggleMood(id: string) {
		onFilters({ ...filters, mood: filters.mood === id ? null : id })
	}

	function toggleGenre(id: string) {
		const on = filters.genres.includes(id)
		onFilters({
			...filters,
			genres: on ? filters.genres.filter((g) => g !== id) : [...filters.genres, id],
		})
	}

	// Subgenres are only worth showing for a genre that is actually selected,
	// since all twenty expanded at once is 442 chips.
	const expanded = taxonomy.genres.filter((g) => filters.genres.includes(g.id))

	const chosen = filters.mood !== null || filters.genres.length > 0

	return (
		<>
			<h1 className={css.heading}>Explore</h1>

			{taxonomy.error ? (
				<p className={css.empty}>Could not load the mood and genre lists.</p>
			) : null}

			<div className={css.filterGroup}>
				<div className={css.filterLabel}>Mood</div>
				<div className={css.filterChips}>
					{taxonomy.moods.map(function (mood) {
						return (
							<button
								key={mood.id}
								type="button"
								className={classnames(css.filterChip, {
									[css.filterChipOn]: filters.mood === mood.id,
								})}
								onClick={() => toggleMood(mood.id)}
								title={mood.description || mood.name}
							>
								{mood.name}
							</button>
						)
					})}
				</div>
			</div>

			<div className={css.filterGroup}>
				<div className={css.filterLabel}>Genre</div>
				<div className={css.filterChips}>
					{taxonomy.genres.map(function (genre) {
						return (
							<button
								key={genre.id}
								type="button"
								className={classnames(css.filterChip, {
									[css.filterChipOn]: filters.genres.includes(genre.id),
								})}
								onClick={() => toggleGenre(genre.id)}
							>
								{genre.name}
							</button>
						)
					})}
				</div>
			</div>

			{expanded.map(function (genre) {
				return (
					<div className={css.filterGroup} key={genre.id}>
						<div className={css.filterLabel}>{genre.name}</div>
						<div className={css.filterChips}>
							{genre.subgenres.map(function (sub) {
								return (
									<button
										key={sub.id}
										type="button"
										className={classnames(css.filterChip, css.filterChipSub, {
											[css.filterChipOn]: filters.genres.includes(sub.id),
										})}
										onClick={() => toggleGenre(sub.id)}
									>
										{sub.name}
									</button>
								)
							})}
						</div>
					</div>
				)
			})}

			<div className={css.filterFoot}>
				<span className={css.filterCount}>
					{state.loading
						? "Loading..."
						: state.error
							? "Could not load shows."
							: `${state.total.toLocaleString()} ${state.total === 1 ? "show" : "shows"}`}
				</span>
				{chosen ? (
					<button
						type="button"
						className={css.filterClear}
						onClick={() => onFilters({ mood: null, genres: [] })}
					>
						Clear
					</button>
				) : null}
			</div>

			{!state.loading && !state.error && state.shows.length === 0 ? (
				<p className={css.empty}>
					Nothing carries all of those at once. Filters narrow rather than widen, so
					try removing one.
				</p>
			) : null}

			<div className={css.grid}>
				{state.shows.map(function (show) {
					return (
						<button
							key={show.url}
							type="button"
							className={css.tile}
							onClick={() => onOpen(show.url)}
						>
							<div
								className={css.tileArt}
								style={
									show.image ? { backgroundImage: `url(${show.image})` } : undefined
								}
							/>
							<div className={css.tileBody}>
								<h2 className={css.tileTitle}>{show.title}</h2>
								<p className={css.tileSub}>
									{[show.date, show.location].filter(Boolean).join(" · ")}
								</p>
								<Tags
									genres={show.genres}
									moods={show.moods}
									maxGenres={3}
									maxMoods={1}
								/>
							</div>
						</button>
					)
				})}
			</div>

			{state.hasMore ? (
				<div className={css.loadMoreRow}>
					<button
						type="button"
						className={css.button}
						onClick={state.loadMore}
						disabled={state.loadingMore}
					>
						{state.loadingMore ? "Loading..." : "Load more"}
					</button>
				</div>
			) : null}
		</>
	)
}

export function MixtapesView(props: MixtapesProps) {
	const { mixtapes, loading, source, onSelect } = props

	return (
		<>
			<h1 className={css.heading}>Infinite Mixtapes</h1>
			{loading && mixtapes.length === 0 ? (
				<p className={css.empty}>Loading mixtapes…</p>
			) : null}
			{!loading && mixtapes.length === 0 ? (
				<p className={css.empty}>Could not load mixtapes.</p>
			) : null}
			<div className={css.grid}>
				{mixtapes.map(function (mixtape) {
					const active = sameSource(source, {
						kind: "mixtape",
						alias: mixtape.alias,
					})
					return (
						<button
							key={mixtape.alias}
							type="button"
							className={classnames(css.tile, { [css.tileActive]: active })}
							onClick={() => onSelect(mixtape.alias)}
						>
							<div
								className={css.tileArt}
								style={
									mixtape.image
										? { backgroundImage: `url(${mixtape.image})` }
										: undefined
								}
							/>
							<div className={css.tileBody}>
								<h2 className={css.tileTitle}>
									{active ? "▍ " : ""}
									{mixtape.title}
								</h2>
								<p className={css.tileSub}>{mixtape.subtitle}</p>
							</div>
						</button>
					)
				})}
			</div>
		</>
	)
}

type ScheduleProps = {
	live: Info | null
}

function ScheduleColumn(props: { title: string; shows: ShowInfo[] }) {
	const { title, shows } = props
	return (
		<section>
			<h1 className={css.heading}>{title}</h1>
			{shows.map(function (show, i) {
				return (
					<div
						key={`${show.showAlias}-${show.starts.toISOString()}`}
						className={classnames(css.row, { [css.rowNow]: i === 0 })}
					>
						<span className={css.rowTime}>{time(show.starts)}</span>
						<span className={css.rowName}>{show.name}</span>
					</div>
				)
			})}
		</section>
	)
}

export function ScheduleView(props: ScheduleProps) {
	const { live } = props

	if (!live) {
		return <p className={css.empty}>Loading schedule…</p>
	}

	return (
		<div className={css.scheduleCols}>
			<ScheduleColumn title="Channel 1" shows={live.channel1.schedule} />
			<ScheduleColumn title="Channel 2" shows={live.channel2.schedule} />
		</div>
	)
}

type SearchProps = {
	query: string
	onQuery: (query: string) => void
	state: SearchState
	order: SortOrder
	onOrder: (order: SortOrder) => void
	onOpen: (url: string) => void
}

export function SearchView(props: SearchProps) {
	const { query, onQuery, state, order, onOrder, onOpen } = props
	const pasted = isShowURL(query)
	const results = sortResults(state.results, order)

	return (
		<>
			<h1 className={css.heading}>Search the archive</h1>
			<div className={css.searchRow}>
				<input
					className={css.searchInput}
					value={query}
					placeholder="Show, artist, or paste an nts.live show link"
					aria-label="Search"
					onChange={(e) => onQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && pasted) {
							onOpen(query.trim())
						}
					}}
				/>
				{pasted ? (
					<button
						type="button"
						className={css.button}
						onClick={() => onOpen(query.trim())}
					>
						Open
					</button>
				) : null}
				{state.results.length > 0 ? (
					<select
						className={css.barSelect}
						value={order}
						aria-label="Sort results"
						onChange={(e) => onOrder(e.target.value as SortOrder)}
					>
						<option value="relevance">Relevance</option>
						<option value="newest">Newest</option>
						<option value="oldest">Oldest</option>
					</select>
				) : null}
			</div>

			{pasted ? (
				<p className={css.empty}>That is a show link. Press Open to load it.</p>
			) : null}
			{state.loading ? <p className={css.empty}>Searching…</p> : null}
			{state.error ? <p className={css.empty}>Search failed.</p> : null}
			{!state.loading &&
			!state.error &&
			query.trim().length >= 2 &&
			!pasted &&
			state.results.length === 0 ? (
				<p className={css.empty}>Nothing found.</p>
			) : null}

			<div className={css.grid}>
				{results.map(function (result) {
					return (
						<button
							key={result.url}
							type="button"
							className={css.tile}
							onClick={() => onOpen(result.url)}
						>
							<div
								className={css.tileArt}
								style={
									result.image
										? { backgroundImage: `url(${result.image})` }
										: undefined
								}
							/>
							<div className={css.tileBody}>
								<h2 className={css.tileTitle}>{result.title}</h2>
								<p className={css.tileSub}>
									{[result.date, result.location].filter(Boolean).join(" · ")}
								</p>
								<Tags
									genres={result.genres}
									moods={result.moods}
									maxGenres={3}
									maxMoods={1}
								/>
							</div>
						</button>
					)
				})}
			</div>
		</>
	)
}

type MixtapeDetailProps = {
	mixtape: Mixtape
	playing: boolean
	onPlay: () => void
	onStop: () => void
	onBack: () => void
}

export function MixtapeDetail(props: MixtapeDetailProps) {
	const { mixtape, playing, onPlay, onStop, onBack } = props

	return (
		<>
			<button type="button" className={css.backLink} onClick={onBack}>
				← All mixtapes
			</button>

			<article className={css.detail}>
				<div
					className={css.detailArt}
					style={
						mixtape.image ? { backgroundImage: `url(${mixtape.image})` } : undefined
					}
				/>
				<div className={css.detailBody}>
					<h1 className={css.detailTitle}>{mixtape.title}</h1>
					<p className={css.detailSub}>{mixtape.subtitle}</p>
					{mixtape.description ? (
						<p className={css.detailDesc}>{mixtape.description}</p>
					) : null}
					<div className={css.cardActions}>
						<button
							type="button"
							className={classnames(css.button, { [css.buttonActive]: playing })}
							onClick={playing ? onStop : onPlay}
						>
							{playing ? "Stop" : "Play"}
						</button>
					</div>
				</div>
			</article>
		</>
	)
}

type ArchiveProps = {
	show: ArchiveShow | null
	// A show has been asked for and has not arrived yet. Distinct from show being
	// null, because opening a second show while reading a first would otherwise
	// leave the first one's details on screen looking like nothing happened.
	loading: boolean
	// Where opening this show came from, so the way back is the way in. The
	// archive is only ever arrived at from somewhere else: a search result, an
	// explore tile, or a pasted link.
	backLabel: string
	onBack: () => void
	// Asked for, but the embedded player has not reported back yet.
	starting: boolean
	// Zero unless this is the show that is loaded, so a show being read while
	// another plays does not show the other one's progress as its own.
	position: number
	duration: number
	onSeek: (seconds: number) => void
	playing: boolean
	onToggle: () => void
	onOriginal: (url: string) => void
}

/**
 * Copies one track's artist and title.
 *
 * The point of a tracklist is finding the record afterwards, and retyping what
 * is already on screen is the friction between the two. Confirms in place
 * rather than with a toast, so the answer sits next to the thing acted on.
 */
// A two hour show needs a bigger step than a song does.
const SKIP = 30

function CopyTrack(props: { text: string }) {
	const [done, setDone] = useState(false)

	useEffect(
		function () {
			if (!done) {
				return
			}
			const timer = setTimeout(() => setDone(false), 1400)
			return () => clearTimeout(timer)
		},
		[done],
	)

	return (
		<button
			type="button"
			className={css.copyTrack}
			title="Copy this track"
			aria-label={`Copy ${props.text}`}
			onClick={function () {
				navigator.clipboard.writeText(props.text).then(
					() => setDone(true),
					() => {},
				)
			}}
		>
			{done ? "Copied" : "Copy"}
		</button>
	)
}

/**
 * A show's tracklist, shared by the details screen and the full screen view.
 *
 * Deliberately without timings. The artists and titles are public, and appear
 * in the page a logged out visitor is served; the offsets are what NTS sells to
 * Supporters, so they are not parsed at all.
 */
function Tracklist(props: { tracks: ArchiveShow["tracklist"] }) {
	const { tracks } = props

	if (!tracks || tracks.length === 0) {
		return null
	}

	return (
		<section className={css.tracklist}>
			<h2 className={css.heading}>Tracklist</h2>
			{tracks.map(function (track, i) {
				return (
					<div key={`${track.artist}-${track.title}-${i}`} className={css.row}>
						<span className={css.rowIndex}>{String(i + 1).padStart(2, "0")}</span>
						<span className={css.rowName}>
							{track.artist ? `${track.artist} - ` : ""}
							{track.title}
						</span>
						<CopyTrack
							text={track.artist ? `${track.artist} - ${track.title}` : track.title}
						/>
					</div>
				)
			})}
		</section>
	)
}

type TransportProps = {
	position: number
	duration: number
	onSeek: (seconds: number) => void
}

/**
 * Skip back, scrub, skip forward.
 *
 * Shown for anything with audio, not only once it is playing. The length is
 * unknown until the player has loaded, which does not happen until playback
 * starts, so waiting on it meant a recording had no visible transport at all
 * until after it began. It sits disabled and reading --:-- until the length
 * arrives, rather than 0:00, which read as a broken control rather than one
 * waiting on a length.
 */
function Transport(props: TransportProps) {
	const { position, duration, onSeek } = props
	const unknown = duration === 0

	return (
		<div className={css.transport}>
			<button
				type="button"
				className={css.skip}
				disabled={unknown}
				onClick={() => onSeek(Math.max(0, position - SKIP))}
				title={`Back ${SKIP} seconds`}
				aria-label={`Back ${SKIP} seconds`}
			>
				{`- ${SKIP}s`}
			</button>

			<span className={css.scrubTime}>{unknown ? "--:--" : clock(position)}</span>
			<input
				className={css.transportRange}
				type="range"
				disabled={unknown}
				min={0}
				max={Math.max(1, Math.floor(duration))}
				step={1}
				value={Math.min(position, Math.floor(duration))}
				aria-label="Seek"
				onChange={(e) => onSeek(Number(e.target.value))}
			/>
			<span className={css.scrubTime}>{unknown ? "--:--" : clock(duration)}</span>

			<button
				type="button"
				className={css.skip}
				disabled={unknown}
				onClick={() => onSeek(Math.min(Math.floor(duration), position + SKIP))}
				title={`Forward ${SKIP} seconds`}
				aria-label={`Forward ${SKIP} seconds`}
			>
				{`+ ${SKIP}s`}
			</button>
		</div>
	)
}

export function ArchiveView(props: ArchiveProps) {
	const {
		show,
		loading,
		playing,
		starting,
		position,
		duration,
		onSeek,
		onToggle,
		onOriginal,
		backLabel,
		onBack,
	} = props

	// Checked before the show, so opening a second show while reading a first
	// replaces the details rather than leaving the old ones up. Keeping the way
	// back available matters: waiting is exactly when someone changes their mind.
	if (loading) {
		return (
			<>
				<button type="button" className={css.backLink} onClick={onBack}>
					← {backLabel}
				</button>
				<h1 className={css.heading}>Archive</h1>
				<p className={css.empty}>Loading show…</p>
			</>
		)
	}

	if (!show) {
		return <p className={css.empty}>No archive show loaded. Find one in Search.</p>
	}

	return (
		<>
			<button type="button" className={css.backLink} onClick={onBack}>
				← {backLabel}
			</button>
			<h1 className={css.heading}>Archive</h1>
			<article className={css.card}>
				<div
					className={css.cardArt}
					style={show.image ? { backgroundImage: artLayers(show.image) } : undefined}
				/>
				<div className={css.cardBody}>
					<h2 className={css.cardTitle}>{show.name}</h2>
					<div className={css.cardMeta}>
						<span>{new Date(show.date).toLocaleDateString()}</span>
						{show.location ? <span>{show.location}</span> : null}
						<span>{show.source?.source ?? "no audio source"}</span>
					</div>
					<Tags genres={show.genres} moods={show.moods} maxGenres={6} maxMoods={3} />
					<div className={css.cardActions}>
						<button
							type="button"
							className={classnames(css.button, {
								[css.buttonActive]: playing,
								[css.buttonWaiting]: starting,
							})}
							onClick={onToggle}
						>
							{playing ? "Stop" : "Play"}
						</button>
						{show.url ? (
							<button
								type="button"
								className={css.button}
								onClick={() => onOriginal(show.url)}
							>
								Open on NTS
							</button>
						) : null}
						{show.source?.url ? (
							<button
								type="button"
								className={css.button}
								onClick={() => onOriginal(show.source.url)}
							>
								Open on{" "}
								{show.source.source === "mixcloud" ? "Mixcloud" : "SoundCloud"}
							</button>
						) : null}
					</div>

					{show.source?.url ? (
						<Transport position={position} duration={duration} onSeek={onSeek} />
					) : null}
				</div>
			</article>

			<Tracklist tracks={show.tracklist} />
		</>
	)
}

type HistoryProps = {
	entries: HistoryEntry[]
	onOpen: (url: string) => void
	onClear: () => void
}

export function HistoryView(props: HistoryProps) {
	const { entries, onOpen, onClear } = props

	if (entries.length === 0) {
		return <p className={css.empty}>Nothing played yet this session.</p>
	}

	return (
		<>
			<div className={css.panelHead}>
				<span className={css.heading}>Listening history</span>
				<button type="button" className={css.panelToggle} onClick={onClear}>
					Clear
				</button>
			</div>

			{entries.map(function (entry, i) {
				const when = entry.at ? new Date(entry.at) : null
				return (
					<div key={`${entry.at}-${entry.name}-${i}`} className={css.row}>
						<span className={css.rowTime}>
							{when && !Number.isNaN(when.getTime())
								? when.toLocaleString([], {
										day: "2-digit",
										month: "short",
										hour: "2-digit",
										minute: "2-digit",
									})
								: ""}
						</span>
						<span className={css.rowName}>
							{entry.name}
							{entry.detail ? (
								<span className={css.historyDetail}> {entry.detail}</span>
							) : null}
						</span>
						{entry.kind === "archive" && entry.url ? (
							<button
								type="button"
								className={css.panelToggle}
								onClick={() => onOpen(entry.url as string)}
							>
								Open
							</button>
						) : null}
					</div>
				)
			})}
		</>
	)
}

const STATUS_LABEL: Record<PlayerStatus, string> = {
	idle: "Stopped",
	connecting: "Connecting",
	playing: "Live",
	reconnecting: "Reconnecting",
	failed: "Stream unavailable",
}

/** The contents of an output picker, shared so the two cannot drift apart. */
function OutputOptions(props: { outputs: AudioOutput[] }) {
	return (
		<>
			<option value="">System default</option>
			{props.outputs
				.filter((o) => o.id !== "default")
				.map((o) => (
					<option key={o.id} value={o.id}>
						{o.label}
					</option>
				))}
		</>
	)
}

function StatusDot(props: { status: PlayerStatus }) {
	return (
		<span
			className={classnames(css.dot, {
				[css.dotPlaying]: props.status === "playing",
				[css.dotWarn]:
					props.status === "connecting" || props.status === "reconnecting",
				[css.dotError]: props.status === "failed",
			})}
		/>
	)
}

type PanelProps = {
	probe: StreamProbe | null
	loading: boolean
	health: StreamHealth
	status: PlayerStatus
	detailed: boolean
	onDetailed: (detailed: boolean) => void
	outputs: AudioOutput[]
	outputDevice: string
	onOutputDevice: (id: string) => void
	onRefreshOutputs: () => void
	mixtapeFormat: "mp3" | "aac"
	onMixtapeFormat: (format: "mp3" | "aac") => void
	canChooseFormat: boolean
	liveDelivery: "hls" | "direct"
	onLiveDelivery: (delivery: "hls" | "direct") => void
	sleepRemaining: number | null
	onSleep: (minutes: number) => void
	onCancelSleep: () => void
	outputSampleRate: number | null
	// While a device holds the stream nothing is decoded here, so any statement
	// about the local output would describe a path the audio is not taking.
	casting: boolean
}

function HealthGraph(props: { health: StreamHealth; height: number }) {
	const { health, height } = props
	const canvas = useRef<HTMLCanvasElement | null>(null)

	useEffect(
		function () {
			const el = canvas.current
			if (!el) {
				return
			}

			const ctx = el.getContext("2d")
			if (!ctx) {
				return
			}

			function draw() {
				if (!el || !ctx) {
					return
				}
				const ratio = window.devicePixelRatio || 1
				const width = el.clientWidth
				// Laid out to nothing yet. Drawing now would size the bitmap to zero
				// and leave it that way until the next health sample arrives.
				if (width === 0) {
					return
				}
				// Use the prop rather than clientHeight so a change of size actually
				// redraws, instead of waiting for the next health sample.
				const h = height
				el.width = Math.round(width * ratio)
				el.height = Math.round(h * ratio)
				ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
				ctx.clearRect(0, 0, width, h)

				const points = health.history
				if (points.length === 0) {
					return
				}

				// The raw buffer trace is a sawtooth; smooth it so the graph shows the
				// trend rather than the sampling noise.
				const values = smooth(points.map((p) => p.buffered))

				// Scale to the largest value seen, with a floor so a healthy flat line
				// does not fill the frame and read as alarming.
				const peak = Math.max(4, ...values)
				const step = width / Math.max(1, values.length - 1)
				const y = (v: number) => h - (v / peak) * (h - 3) - 1

				// Smooth curve through the points rather than straight segments.
				function trace(c: CanvasRenderingContext2D) {
					c.moveTo(0, y(values[0]))
					for (let i = 1; i < values.length; i++) {
						const px = (i - 1) * step
						const cx = i * step
						const mid = (px + cx) / 2
						c.bezierCurveTo(
							mid,
							y(values[i - 1]),
							mid,
							y(values[i]),
							cx,
							y(values[i]),
						)
					}
				}

				ctx.beginPath()
				ctx.moveTo(0, h)
				ctx.lineTo(0, y(values[0]))
				trace(ctx)
				ctx.lineTo((values.length - 1) * step, h)
				ctx.closePath()
				ctx.fillStyle = "rgba(230, 0, 45, 0.16)"
				ctx.fill()

				ctx.beginPath()
				trace(ctx)
				ctx.strokeStyle = "#e6002d"
				ctx.lineWidth = 1.5
				ctx.lineJoin = "round"
				ctx.stroke()

				// Mark every moment the watchdog was reconnecting.
				ctx.fillStyle = "rgba(255, 176, 46, 0.85)"
				points.forEach(function (point, i) {
					if (point.reconnecting) {
						ctx.fillRect(i * step - 1, 0, 2, h)
					}
				})
			}

			draw()

			// A canvas bitmap does not resize with its element: the browser just
			// stretches whatever was drawn last. Without this the graph is only
			// correct at the width it happened to be drawn at, and every window
			// resize smears it until the next sample arrives a second later.
			const observer = new ResizeObserver(function () {
				draw()
			})
			observer.observe(el)
			return function () {
				observer.disconnect()
			}
		},
		[health, height],
	)

	return <canvas className={css.graph} style={{ height }} ref={canvas} />
}

function Stat(props: { label: string; value: string }) {
	return (
		<div className={css.stat}>
			<div className={css.statLabel}>{props.label}</div>
			<div className={css.statValue}>{props.value}</div>
		</div>
	)
}

function contentTypeLabel(contentType: string): string {
	return contentType.split(";")[0].trim() || "-"
}

export function StreamPanel(props: PanelProps) {
	const {
		probe,
		loading,
		health,
		status,
		detailed,
		onDetailed,
		outputs,
		outputDevice,
		onOutputDevice,
		onRefreshOutputs,
		mixtapeFormat,
		onMixtapeFormat,
		canChooseFormat,
		liveDelivery,
		onLiveDelivery,
		sleepRemaining,
		onSleep,
		onCancelSleep,
		outputSampleRate,
		casting,
	} = props

	const measured = probe?.measured ?? null
	const reported = probe?.reported ?? null

	// Only ever state the codec the frames actually prove. A Content-Type is a
	// claim, so it is shown as one, separately.
	const quality = measured
		? `${measured.bitrate} kbps · ${measured.sampleRate ? `${(measured.sampleRate / 1000).toFixed(1)} kHz` : "?"} · ${measured.channelMode}`
		: loading
			? "Probing…"
			: "Not measured"

	// A stream at one rate played on a device set to another is resampled by the
	// OS before it is heard. Only worth stating when both numbers are known.
	const streamRate = measured?.sampleRate ?? null
	const resampling =
		!casting && streamRate && outputSampleRate
			? {
					mismatched: Math.abs(streamRate - outputSampleRate) > 1,
					label:
						Math.abs(streamRate - outputSampleRate) > 1
							? `Device at ${(outputSampleRate / 1000).toFixed(1)} kHz · resampled from ${(streamRate / 1000).toFixed(1)} kHz`
							: `Device at ${(outputSampleRate / 1000).toFixed(1)} kHz · no resampling`,
				}
			: null

	const minutes = Math.floor(health.uptime / 60)
	const seconds = health.uptime % 60
	const uptime = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
	const window = Math.round((health.history.length * 500) / 1000)

	return (
		<section className={css.panel}>
			<div className={css.panelHead}>
				<span className={css.heading}>Stream</span>
				<button
					type="button"
					className={css.panelToggle}
					onClick={() => onDetailed(!detailed)}
				>
					{detailed ? "Minimal" : "Detailed"}
				</button>
			</div>

			<div className={css.panelQuality}>
				{measured ? measured.codec : loading ? "Reading stream…" : "Unverified"}
			</div>
			<div className={css.panelSub}>{quality}</div>
			{resampling ? (
				<div
					className={classnames(css.panelSub, {
						[css.resampling]: resampling.mismatched,
					})}
				>
					{resampling.label}
				</div>
			) : null}
			{resampling?.mismatched ? (
				<div className={css.settingHint}>
					Nothing this app can change: the rate is set by the operating system.
					Matching your output device to {(streamRate ?? 44100) / 1000} kHz in the
					system sound settings avoids it, though most video and games are 48 kHz and
					would then be the thing resampled instead.
				</div>
			) : null}

			<HealthGraph health={health} height={detailed ? 62 : 34} />
			<div className={css.graphLabel}>
				Buffer ahead · last {window}s · {health.buffered.toFixed(1)}s now
			</div>

			<div className={css.output}>
				<span className={css.compareLabel}>Sleep timer</span>
				{sleepRemaining === null ? (
					<div className={css.sleepOptions}>
						{[15, 30, 60, 90].map((m) => (
							<button
								key={m}
								type="button"
								className={css.panelToggle}
								onClick={() => onSleep(m)}
							>
								{m}m
							</button>
						))}
					</div>
				) : (
					<div className={css.sleepOptions}>
						<span className={css.statValue}>
							{Math.floor(sleepRemaining / 60)}m {sleepRemaining % 60}s
						</span>
						<button
							type="button"
							className={css.panelToggle}
							onClick={onCancelSleep}
						>
							Cancel
						</button>
					</div>
				)}
			</div>

			<label className={css.output}>
				<span className={css.compareLabel}>Live delivery</span>
				<select
					className={css.select}
					value={liveDelivery}
					onChange={(e) =>
						onLiveDelivery(e.target.value === "direct" ? "direct" : "hls")
					}
				>
					<option value="hls">Buffered</option>
					<option value="direct">Direct</option>
				</select>
			</label>
			<div className={css.settingHint}>
				Buffered keeps about a minute of audio in hand, so a network stutter is
				absorbed rather than heard, at the cost of running roughly a minute behind
				the live broadcast. Direct is only seconds behind but has almost no cushion,
				so any interruption is audible.
			</div>

			{canChooseFormat ? (
				<label className={css.output}>
					<span className={css.compareLabel}>Mixtape format</span>
					<select
						className={css.select}
						value={mixtapeFormat}
						onChange={(e) =>
							onMixtapeFormat(e.target.value === "aac" ? "aac" : "mp3")
						}
					>
						<option value="mp3">MP3 (direct)</option>
						<option value="aac">AAC (HLS)</option>
					</select>
				</label>
			) : null}

			{/* Deliberately not gated on a non-empty list: an empty list is exactly
			    when someone wants to press refresh, and hiding the control then
			    would be the opposite of useful. "System default" is always valid. */}
			<label className={css.output}>
				<span className={css.compareLabel}>Output</span>
				<select
					className={css.select}
					value={outputDevice}
					onChange={(e) => onOutputDevice(e.target.value)}
				>
					<OutputOptions outputs={outputs} />
				</select>
				<button
					type="button"
					className={css.refreshButton}
					onClick={onRefreshOutputs}
					title="Look for audio devices again"
					aria-label="Refresh audio device list"
				>
					Refresh
				</button>
			</label>

			{detailed ? (
				<>
					<div className={css.stats}>
						<Stat label="Buffered" value={`${health.buffered.toFixed(1)}s`} />
						<Stat label="State" value={STATUS_LABEL[status]} />
						<Stat label="Uptime" value={uptime} />
						<Stat label="Reconnects" value={String(health.reconnects)} />
						<Stat
							label="Frames read"
							value={measured ? String(measured.frames) : "-"}
						/>
						<Stat label="Served by" value={reported?.station || "-"} />
						<Stat
							label="Device rate"
							value={
								outputSampleRate
									? `${(outputSampleRate / 1000).toFixed(1)} kHz`
									: "-"
							}
						/>
					</div>

					<div className={css.compare}>
						<div className={css.compareRow}>
							<span className={css.compareLabel}>Measured from audio</span>
							<span className={css.compareValue}>
								{measured
									? `${measured.codec}, ${measured.bitrate} kbps, ${measured.sampleRate} Hz, ${measured.channelMode}`
									: "could not decode frames"}
							</span>
						</div>
						<div className={css.compareRow}>
							<span className={css.compareLabel}>Reported by server</span>
							<span className={css.compareValue}>
								{reported
									? `${contentTypeLabel(reported.contentType)}${reported.bitrate ? `, ${reported.bitrate} kbps` : ""}${reported.sampleRate ? `, ${reported.sampleRate} Hz` : ""}`
									: "-"}
							</span>
						</div>
					</div>

					{probe?.edge ? <div className={css.panelFoot}>{probe.edge}</div> : null}
				</>
			) : null}
		</section>
	)
}

type FullProps = {
	now: NowPlaying
	probe: StreamProbe | null
	probeLoading: boolean
	health: StreamHealth
	detailed: boolean
	onDetailed: (detailed: boolean) => void
	outputs: AudioOutput[]
	outputDevice: string
	onOutputDevice: (id: string) => void
	onRefreshOutputs: () => void
	mixtapeFormat: "mp3" | "aac"
	onMixtapeFormat: (format: "mp3" | "aac") => void
	canChooseFormat: boolean
	liveDelivery: "hls" | "direct"
	onLiveDelivery: (delivery: "hls" | "direct") => void
	sleepRemaining: number | null
	onSleep: (minutes: number) => void
	onCancelSleep: () => void
	outputSampleRate: number | null
	// While a device holds the stream nothing is decoded here, so any statement
	// about the local output would describe a path the audio is not taking.
	casting: boolean
	// The archive show playing, if one is. An archive show comes from an embedded
	// player rather than a stream, so the stream diagnostics describe nothing
	// that is happening: its tracklist is what there is to say about it.
	archive: ArchiveShow | null
	// Set only for a recording, and then it is the word to use for its state.
	statusLabel?: string
	// Where a recording has got to, and how long it is. Zero length means there
	// is nothing to scrub: a live channel or a mixtape has no end.
	position: number
	duration: number
	onSeek: (seconds: number) => void
	// Opens a URL in the browser. An archive show has two worth offering, its
	// own NTS page and the host the audio actually plays from.
	onOpenUrl: (url: string) => void
	status: PlayerStatus
	playing: boolean
	volume: number
	onToggle: () => void
	onVolume: (volume: number) => void
	onShowPage: (alias: string) => void
	onClose: () => void
}

export function FullScreen(props: FullProps) {
	const {
		now,
		statusLabel,
		position,
		duration,
		onSeek,
		probe,
		probeLoading,
		health,
		detailed,
		onDetailed,
		outputs,
		outputDevice,
		onOutputDevice,
		onRefreshOutputs,
		mixtapeFormat,
		onMixtapeFormat,
		canChooseFormat,
		liveDelivery,
		onLiveDelivery,
		sleepRemaining,
		onSleep,
		onCancelSleep,
		outputSampleRate,
		casting,
		archive,
		onOpenUrl,
		status,
		playing,
		volume,
		onToggle,
		onVolume,
		onShowPage,
		onClose,
	} = props

	useEffect(
		function () {
			function onKey(evt: KeyboardEvent) {
				if (evt.key === "Escape") {
					onClose()
				}
			}
			document.addEventListener("keydown", onKey)
			return () => document.removeEventListener("keydown", onKey)
		},
		[onClose],
	)

	return (
		<div className={css.full}>
			<div className={css.fullBackdrop} />
			<div className={classnames(css.fullTop, { [css.fullTopMac]: isMac })}>
				<button
					type="button"
					className={css.iconButton}
					aria-label="Close full screen"
					onClick={onClose}
				>
					<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
						<path
							d="M3 10 L8 5 L13 10"
							stroke="currentColor"
							fill="none"
							strokeWidth="1.5"
						/>
					</svg>
				</button>
			</div>

			<div className={css.fullBody}>
				<div
					className={css.fullArt}
					style={
						now.image ? { backgroundImage: fullArtLayers(now.image) } : undefined
					}
				/>
				<div className={css.fullInfo}>
					<div className={css.fullStatus}>
						<StatusDot status={status} />
						{statusLabel ?? STATUS_LABEL[status]}
					</div>
					<h1 className={css.fullTitle}>{now.title}</h1>
					<div className={css.fullMeta}>
						{now.starts && now.ends ? (
							<span>
								{time(now.starts)} - {time(now.ends)}
							</span>
						) : null}
						<span>{now.subtitle}</span>
					</div>
					{now.description ? (
						<p className={css.fullDesc}>{now.description}</p>
					) : null}
					<Tags genres={now.genres} moods={now.moods} maxGenres={6} maxMoods={3} />
					<div className={css.fullControls}>
						<button type="button" className={css.button} onClick={onToggle}>
							{playing ? "Stop" : "Play"}
						</button>
						{/* An archive show has no showAlias here, and two better links:
						    its own page, and wherever the audio is really hosted. */}
						{archive?.url ? (
							<button
								type="button"
								className={css.button}
								onClick={() => onOpenUrl(archive.url)}
							>
								Open on NTS
							</button>
						) : null}
						{archive?.source?.url ? (
							<button
								type="button"
								className={css.button}
								onClick={() => onOpenUrl(archive.source.url)}
							>
								Open on{" "}
								{archive.source.source === "mixcloud" ? "Mixcloud" : "SoundCloud"}
							</button>
						) : null}
						{now.showAlias ? (
							<button
								type="button"
								className={css.button}
								onClick={() => onShowPage(now.showAlias)}
							>
								Show page
							</button>
						) : null}
						<input
							className={css.volume}
							type="range"
							min={0}
							max={1}
							step={0.01}
							value={volume}
							aria-label="Volume"
							onChange={(e) => onVolume(Number(e.target.value))}
						/>
					</div>

					{/* Only a recording has an end to scrub towards. A live channel and a
					    mixtape run on, so the transport stays out of the way entirely
					    rather than sitting there disabled. */}
					{duration > 0 ? (
						<Transport position={position} duration={duration} onSeek={onSeek} />
					) : null}

					{/* An archive show has no stream to report on. Its tracklist is the
					    thing worth having here, and it is the same one the details
					    screen shows rather than a second copy. */}
					{archive ? (
						<Tracklist tracks={archive.tracklist} />
					) : (
						<StreamPanel
							probe={probe}
							loading={probeLoading}
							health={health}
							status={status}
							detailed={detailed}
							onDetailed={onDetailed}
							outputs={outputs}
							outputDevice={outputDevice}
							onOutputDevice={onOutputDevice}
							onRefreshOutputs={onRefreshOutputs}
							mixtapeFormat={mixtapeFormat}
							onMixtapeFormat={onMixtapeFormat}
							canChooseFormat={canChooseFormat}
							liveDelivery={liveDelivery}
							onLiveDelivery={onLiveDelivery}
							sleepRemaining={sleepRemaining}
							onSleep={onSleep}
							onCancelSleep={onCancelSleep}
							outputSampleRate={outputSampleRate}
							casting={casting}
						/>
					)}
				</div>
			</div>
		</div>
	)
}

type BarProps = {
	now: NowPlaying
	probe: StreamProbe | null
	status: PlayerStatus
	playing: boolean
	volume: number
	muted: boolean
	source: Source | null
	onChannel: (id: 1 | 2) => void
	health: StreamHealth
	// Only meaningful for archive shows, which have an end. A live stream has no
	// length, so zero means no scrub bar rather than a bar stuck at zero.
	position: number
	duration: number
	onSeek: (seconds: number) => void
	// Given only when there is a page to go to, which is archive shows. A live
	// channel is already the thing on screen.
	onOpenPlaying?: () => void
	// Loaded but stopped. Kept on screen rather than cleared, dimmed so it does
	// not read as playing.
	paused?: boolean
	// Overrides the word for the current state. An archive show waiting on an
	// embedded player is loading rather than connecting: there is no stream to
	// connect to, and the distinction is the app's own elsewhere.
	statusLabel?: string
	onToggle: () => void
	onVolume: (volume: number) => void
	onMute: () => void
	onExpand: () => void
}

type CastButtonProps = {
	devices: CastDevice[]
	target: string | null
	// A device is holding the stream, as opposed to merely being selected.
	casting: boolean
	// Whether there is anything a device could actually be given. Archive shows
	// play through embedded players rather than the stream, so they cannot go to
	// a Cast device at all.
	canCast: boolean
	status: CastStatus
	error?: string
	onOpen: () => void
	onClose: () => void
	onSelect: (deviceId: string) => void
	onStop: () => void
	onRescan: () => void
}

const CAST_NOTE: Record<CastStatus, string> = {
	idle: "",
	connecting: "Connecting to the device",
	buffering: "Connecting to the device",
	playing: "Playing on the device",
	reconnecting: "Lost the device, trying again",
	failed: "The device would not play this",
}

/**
 * Casting, as its own control rather than an entry in the output picker.
 *
 * Handing a device the stream is not the same kind of act as choosing a sound
 * card: the audio stops coming from this machine entirely and the device
 * fetches it directly, which is why it gets a button people can find rather
 * than a line buried in a dropdown.
 */
export function CastButton(props: CastButtonProps) {
	const {
		devices,
		target,
		casting,
		canCast,
		status,
		error,
		onOpen,
		onClose,
		onSelect,
		onStop,
		onRescan,
	} = props
	const [open, setOpen] = useState(false)
	const wrap = useRef<HTMLDivElement | null>(null)

	useEffect(
		function () {
			if (!open) {
				return
			}

			function dismiss(evt: MouseEvent) {
				if (wrap.current && !wrap.current.contains(evt.target as Node)) {
					setOpen(false)
				}
			}

			function onKey(evt: KeyboardEvent) {
				if (evt.key === "Escape") {
					setOpen(false)
				}
			}

			document.addEventListener("mousedown", dismiss)
			document.addEventListener("keydown", onKey)
			return function () {
				document.removeEventListener("mousedown", dismiss)
				document.removeEventListener("keydown", onKey)
			}
		},
		[open],
	)

	function toggle() {
		// Only on the way open. Browsing the network is what makes Windows ask
		// about the firewall, so it waits for someone to actually want it.
		if (open) {
			onClose()
		} else {
			onOpen()
		}
		setOpen((x) => !x)
	}

	const armed = target !== null
	const active = devices.find((d) => d.id === target)
	const note = casting || status === "failed" ? CAST_NOTE[status] : ""

	return (
		<div className={css.castWrap} ref={wrap}>
			<button
				type="button"
				className={classnames(css.iconButton, { [css.castOn]: casting })}
				onClick={toggle}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={casting ? "Casting, change device" : "Cast to a device"}
				title={
					casting && active
						? `Casting to ${active.name}`
						: armed
							? "Waiting for something to play"
							: "Cast to a device"
				}
			>
				<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
					<path
						d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
						fill="currentColor"
					/>
				</svg>
			</button>

			{open ? (
				<div className={css.castMenu} role="menu">
					{devices.length === 0 ? (
						<div className={css.castNote}>Looking for devices...</div>
					) : (
						devices.map(function (device) {
							return (
								<button
									key={device.id}
									type="button"
									role="menuitem"
									disabled={!canCast}
									className={classnames(css.menuItem, {
										[css.castItemOn]: device.id === target && casting,
									})}
									onClick={() => {
										onSelect(device.id)
										setOpen(false)
									}}
								>
									{device.name}
								</button>
							)
						})
					)}

					{/* Archive shows come from embedded players rather than the stream,
					    so there is nothing to hand over. Saying so beats a menu that
					    looks live and does nothing. */}
					{!canCast && devices.length > 0 ? (
						<div className={css.castNote}>
							Pick a channel or mixtape first. Archive shows cannot be cast.
						</div>
					) : null}

					{note ? (
						<div className={css.castNote}>
							{status === "failed" ? (error ?? note) : note}
						</div>
					) : null}

					{armed && !casting && canCast ? (
						<div className={css.castNote}>Handing over the stream...</div>
					) : null}

					<div className={css.castMenuFoot}>
						{armed ? (
							<button
								type="button"
								className={css.menuItem}
								onClick={() => {
									onStop()
									setOpen(false)
								}}
							>
								Stop casting
							</button>
						) : null}
						<button type="button" className={css.menuItem} onClick={onRescan}>
							Search again
						</button>
					</div>
				</div>
			) : null}
		</div>
	)
}

type MiniProps = {
	now: NowPlaying
	source: Source | null
	// A recording's progress. Zero length means a live channel or a mixtape,
	// which has no end to count towards.
	position: number
	duration: number
	// Set only for a recording, and then it is the word to use for its state.
	statusLabel?: string
	status: PlayerStatus
	playing: boolean
	onToggle: () => void
	onExpand: () => void
	onClose: () => void
}

function miniTime(date: Date | null): string {
	if (!date) {
		return ""
	}
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

/**
 * The player this project started as.
 *
 * Deliberately a reconstruction of the original popup rather than a shrunken
 * version of the main window: full bleed artwork with the show printed over it,
 * the channel number in a white square that turns into a play button under the
 * cursor, and the whole header inverting while it is playing. That look is the
 * best thing the app inherited and it does not survive being made generic.
 *
 * Two things the original did not need. It was a menubar popup that closed when
 * it lost focus, so it had no way back and no close button; this is a window,
 * so it needs both, kept small and out of the artwork's way.
 *
 * The strip is the drag handle, since this mode has no title bar.
 */
export function MiniPlayer(props: MiniProps) {
	const {
		now,
		source,
		position,
		duration,
		statusLabel,
		status,
		playing,
		onToggle,
		onExpand,
		onClose,
	} = props

	// The original always had a channel number to print. A mixtape has none, so
	// it gets the play control on its own rather than a made-up digit.
	const channel = source?.kind === "channel" ? String(source.id) : ""

	// Only a recording has a length. Everything else here runs on, so the
	// broadcast window is the only time worth printing for it.
	const recording = duration > 0
	const times = recording
		? `${clock(position)} / ${clock(duration)}`
		: now.starts && now.ends
			? `${miniTime(now.starts)} – ${miniTime(now.ends)}`
			: ""
	// A recording is not live, and saying so over a show from the archive was
	// simply wrong: the status alone reads "Live" while a recording plays. The
	// red dot goes with it, since that is exactly what the dot means.
	const label =
		statusLabel ?? (status === "playing" ? "Live Now" : STATUS_LABEL[status])

	return (
		<div className={classnames(css.mini, { [css.miniPlaying]: playing })}>
			{now.image ? (
				<img src={now.image} className={css.miniImage} alt="" draggable={false} />
			) : (
				<div className={css.miniImage} />
			)}

			<button
				type="button"
				className={css.miniHeader}
				onClick={onToggle}
				aria-label={playing ? "Stop" : "Play"}
			>
				<div className={classnames(css.miniCh, { [css.miniChBare]: !channel })}>
					{channel}
					<PlayButton playing={playing} className={css.miniPlayGlyph} />
				</div>
				<div>
					<div className={css.miniLive}>
						{label}
						{statusLabel ? null : <span className={css.miniDot}>●</span>}
					</div>
					<div>{times}</div>
				</div>
			</button>

			<div className={css.miniWindowControls}>
				<button
					type="button"
					className={css.miniIcon}
					onClick={onExpand}
					aria-label="Back to the full window"
					title="Back to the full window"
				>
					<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
						<path
							d="M6 2H2v4M10 14h4v-4"
							stroke="currentColor"
							strokeWidth="1.6"
							fill="none"
						/>
					</svg>
				</button>
				<button
					type="button"
					className={classnames(css.miniIcon, css.miniClose)}
					onClick={onClose}
					aria-label="Close"
					title="Close"
				>
					<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
						<path
							d="M2 2l8 8M10 2l-8 8"
							stroke="currentColor"
							strokeWidth="1.5"
							fill="none"
						/>
					</svg>
				</button>
			</div>

			{/* A recording has somewhere to get to, and the mini player had no way of
			    showing it. Deliberately a bare line rather than a control: there is
			    no room to scrub accurately at this size, and the window is draggable
			    everywhere else. */}
			{recording ? (
				<div className={css.miniProgress}>
					<div
						className={css.miniProgressFill}
						style={{
							width: `${Math.min(100, (position / duration) * 100)}%`,
						}}
					/>
				</div>
			) : null}

			<div className={css.miniFooter}>
				<div className={css.miniLocation}>{now.location}</div>
				<br />
				<span className={css.miniName}>{now.title}</span>
			</div>
		</div>
	)
}

/** Seconds as m:ss, or h:mm:ss once a show runs past the hour. */
function clock(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds))
	const h = Math.floor(whole / 3600)
	const m = Math.floor((whole % 3600) / 60)
	const sec = String(whole % 60).padStart(2, "0")
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

export function NowPlayingBar(props: BarProps) {
	const {
		now,
		probe,
		status,
		playing,
		volume,
		muted,
		source,
		onChannel,
		health,
		position,
		duration,
		onSeek,
		onOpenPlaying,
		paused,
		statusLabel,
		onToggle,
		onVolume,
		onMute,
		onExpand,
	} = props
	const { title, subtitle, image } = now

	// Compact, and only ever what the frames proved.
	const measured = probe?.measured
	const codec = measured
		? measured.codec.includes("Layer III")
			? "MP3"
			: measured.codec.includes("AAC") || measured.codec.includes("mp4a")
				? "AAC"
				: measured.codec
		: null
	const format = measured
		? [
				`${measured.bitrate} kbps`,
				codec,
				measured.sampleRate
					? `${(measured.sampleRate / 1000).toFixed(1)} kHz`
					: null,
			]
				.filter(Boolean)
				.join(" · ")
		: null

	return (
		<div className={classnames(css.bar, { [css.barPaused]: paused })}>
			<button
				type="button"
				className={css.barArtButton}
				aria-label="Show full screen"
				onClick={onExpand}
				style={image ? { backgroundImage: `url(${image})` } : undefined}
			>
				{/* A stopped show stays on screen, so the artwork has to say which
				    of the two states it is in without being read. */}
				{paused ? (
					<span className={css.barPausedMark}>
						<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
							<rect x="4" y="3" width="3" height="10" fill="currentColor" />
							<rect x="9" y="3" width="3" height="10" fill="currentColor" />
						</svg>
					</span>
				) : null}
				<span className={css.barExpand}>
					<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
						<path
							d="M3 10 L8 5 L13 10"
							stroke="currentColor"
							fill="none"
							strokeWidth="1.5"
						/>
					</svg>
				</span>
			</button>
			<div className={css.barText}>
				{onOpenPlaying ? (
					<button
						type="button"
						className={classnames(css.barTitle, css.barTitleLink)}
						onClick={onOpenPlaying}
						title="Open this show"
					>
						{title}
					</button>
				) : (
					<div className={css.barTitle}>{title}</div>
				)}
				<div className={css.barSub}>{subtitle}</div>
			</div>
			{/* Only for something with an end. A live stream has no length, so this
			    stays out of the way entirely rather than sitting at zero. */}
			{duration > 0 ? (
				<div className={css.scrub}>
					<span className={css.scrubTime}>{clock(position)}</span>
					<input
						className={css.scrubRange}
						type="range"
						min={0}
						max={Math.floor(duration)}
						step={1}
						value={Math.min(position, Math.floor(duration))}
						aria-label="Seek"
						onChange={(e) => onSeek(Number(e.target.value))}
					/>
					<span className={css.scrubTime}>{clock(duration)}</span>
				</div>
			) : null}

			<div className={css.barStream}>
				{/* A show from an embedded player has no stream to describe, and
				    saying so is noise: that it is playing is already on screen. */}
				{statusLabel ? null : (
					<div className={css.barFormat}>{format ?? "No stream"}</div>
				)}
				<div className={css.barStreamSub}>
					<StatusDot status={status} />
					{statusLabel ?? STATUS_LABEL[status]}
					{status === "playing" && !statusLabel
						? ` · ${health.buffered.toFixed(1)}s buffered`
						: ""}
				</div>
			</div>

			<div className={css.barChannels}>
				{([1, 2] as const).map(function (id) {
					const on = sameSource(source, { kind: "channel", id })
					return (
						<button
							key={id}
							type="button"
							className={classnames(css.chip, { [css.chipActive]: on })}
							onClick={() => onChannel(id)}
							title={`Channel ${id}`}
						>
							{id}
						</button>
					)
				})}
			</div>

			{/* Pulses while something has been asked for but has not started. The
			    label still says Stop, because stopping is still what it does. */}
			<button
				type="button"
				className={classnames(css.button, {
					[css.buttonWaiting]: playing && status === "connecting",
				})}
				onClick={onToggle}
			>
				{playing ? "Stop" : "Play"}
			</button>

			<button
				type="button"
				className={css.iconButton}
				onClick={onMute}
				aria-label={muted ? "Unmute" : "Mute"}
				title={muted ? "Unmute" : "Mute"}
			>
				<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
					<path d="M3 6h2.5L9 3v10L5.5 10H3z" fill="currentColor" />
					{muted ? (
						<path
							d="M11 6l3.5 4M14.5 6L11 10"
							stroke="currentColor"
							strokeWidth="1.3"
							fill="none"
						/>
					) : (
						<path
							d="M11.4 5.6a3.4 3.4 0 0 1 0 4.8"
							stroke="currentColor"
							strokeWidth="1.3"
							fill="none"
						/>
					)}
				</svg>
			</button>

			<input
				className={css.volume}
				type="range"
				min={0}
				max={1}
				step={0.01}
				value={muted ? 0 : volume}
				aria-label="Volume"
				onChange={(e) => onVolume(Number(e.target.value))}
			/>
		</div>
	)
}
