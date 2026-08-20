import classnames from "classnames"
import { useEffect, useRef, useState } from "react"

import logo from "../logos/nts.svg"

import type { ShowInfo as ArchiveShow } from "../app/show"
import type { CastDevice, CastStatus } from "./lib/cast"
import type { HistoryEntry, UpdateState } from "./lib/controls"
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
import type { PlayerStatus } from "./player"

import css from "./shell.module.css"

// What the single audio pipeline is pointed at.
export type Source =
	| { kind: "channel"; id: 1 | 2 }
	| { kind: "mixtape"; alias: string }

export type View =
	| "live"
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
export type WindowAction = "minimize" | "maximize" | "close"

// Everything both the bottom bar and the full-screen view need to render.
export type NowPlaying = {
	title: string
	subtitle: string
	image: string
	description: string
	genres: string[]
	moods: string[]
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
	onAction: (action: MenuAction) => void
	onWindow: (action: WindowAction) => void
	update: UpdateState | null
}

export function TitleBar(props: TitleBarProps) {
	const { onAction, onWindow, update } = props
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
				{now && now.genres.length > 0 ? (
					<div className={css.tags}>
						{now.genres.slice(0, 4).map((g) => (
							<span key={g} className={css.tag}>
								{g}
							</span>
						))}
					</div>
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
	playing: boolean
	onToggle: () => void
	onOriginal: (url: string) => void
}

export function ArchiveView(props: ArchiveProps) {
	const { show, playing, onToggle, onOriginal } = props

	if (!show) {
		return <p className={css.empty}>No archive show loaded. Find one in Search.</p>
	}

	return (
		<>
			<h1 className={css.heading}>Archive</h1>
			<article className={css.card}>
				<div
					className={css.cardArt}
					style={show.image ? { backgroundImage: `url(${show.image})` } : undefined}
				/>
				<div className={css.cardBody}>
					<h2 className={css.cardTitle}>{show.name}</h2>
					<div className={css.cardMeta}>
						<span>{new Date(show.date).toLocaleDateString()}</span>
						{show.location ? <span>{show.location}</span> : null}
						<span>{show.source?.source ?? "no audio source"}</span>
					</div>
					<div className={css.cardActions}>
						<button
							type="button"
							className={classnames(css.button, { [css.buttonActive]: playing })}
							onClick={onToggle}
						>
							{playing ? "Stop" : "Play"}
						</button>
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
				</div>
			</article>

			{show.tracklist && show.tracklist.length > 0 ? (
				<section className={css.tracklist}>
					<h2 className={css.heading}>Tracklist</h2>
					{show.tracklist.map(function (track, i) {
						return (
							<div key={`${track.artist}-${track.title}-${i}`} className={css.row}>
								<span className={css.rowTime}>{String(i + 1).padStart(2, "0")}</span>
								<span className={css.rowName}>
									{track.artist ? `${track.artist} - ` : ""}
									{track.title}
								</span>
							</div>
						)
					})}
				</section>
			) : null}
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
					style={now.image ? { backgroundImage: `url(${now.image})` } : undefined}
				/>
				<div className={css.fullInfo}>
					<div className={css.fullStatus}>
						<StatusDot status={status} />
						{STATUS_LABEL[status]}
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
					{now.genres.length > 0 || now.moods.length > 0 ? (
						<div className={css.tags}>
							{now.genres.slice(0, 6).map((g) => (
								<span key={g} className={css.tag}>
									{g}
								</span>
							))}
							{now.moods.slice(0, 4).map((m) => (
								<span key={m} className={classnames(css.tag, css.tagMood)}>
									{m}
								</span>
							))}
						</div>
					) : null}
					<div className={css.fullControls}>
						<button type="button" className={css.button} onClick={onToggle}>
							{playing ? "Stop" : "Play"}
						</button>
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
	outputs: AudioOutput[]
	outputDevice: string
	onOutputDevice: (id: string) => void
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
		outputs,
		outputDevice,
		onOutputDevice,
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
		<div className={css.bar}>
			<button
				type="button"
				className={css.barArtButton}
				aria-label="Show full screen"
				onClick={onExpand}
				style={image ? { backgroundImage: `url(${image})` } : undefined}
			>
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
				<div className={css.barTitle}>{title}</div>
				<div className={css.barSub}>{subtitle}</div>
			</div>
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

			<div className={css.barStream}>
				<div className={css.barFormat}>{format ?? "No stream"}</div>
				<div className={css.barStreamSub}>
					<StatusDot status={status} />
					{STATUS_LABEL[status]}
					{status === "playing" ? ` · ${health.buffered.toFixed(1)}s buffered` : ""}
				</div>
			</div>

			{outputs.length > 0 ? (
				<select
					className={css.barSelect}
					value={outputDevice}
					aria-label="Audio output"
					title="Audio output"
					onChange={(e) => onOutputDevice(e.target.value)}
				>
					<OutputOptions outputs={outputs} />
				</select>
			) : null}

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

			<button type="button" className={css.button} onClick={onToggle}>
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
