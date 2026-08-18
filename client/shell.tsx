import classnames from "classnames"
import { useEffect, useRef, useState } from "react"

import logo from "../logos/nts.svg"

import type { ChannelInfo, Info, ShowInfo } from "./lib/live"
import type { ShowInfo as ArchiveShow } from "../app/show"
import type { Mixtape } from "./lib/mixtapes"
import type { AudioOutput } from "./lib/outputs"
import { type SearchState, isShowURL } from "./lib/search"
import { type StreamHealth, type StreamProbe, smooth } from "./lib/stream-info"
import type { PlayerStatus } from "./player"

import css from "./shell.module.css"

// What the single audio pipeline is pointed at.
export type Source =
	| { kind: "channel"; id: 1 | 2 }
	| { kind: "mixtape"; alias: string }

export type View = "live" | "mixtapes" | "schedule" | "search" | "archive"

export type MenuAction = "schedule" | "explore" | "my-nts" | "reload" | "quit"
export type WindowAction = "minimize" | "maximize" | "close"

// Everything both the bottom bar and the full-screen view need to render.
export type NowPlaying = {
	title: string
	subtitle: string
	image: string
	description: string
	genres: string[]
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
}

export function TitleBar(props: TitleBarProps) {
	const { onAction, onWindow } = props
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
		{ id: "my-nts", label: "My NTS" },
		{ id: "reload", label: "Reload" },
		{ id: "quit", label: "Quit" },
	]

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
				</button>
				{open ? (
					<div className={css.menu}>
						{items.map(function (item) {
							return (
								<button
									key={item.id}
									type="button"
									className={css.menuItem}
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
	following: boolean
	onPlay: () => void
	onStop: () => void
	onTracklist: () => void
	onFollow: () => void
}

export function ChannelCard(props: ChannelCardProps) {
	const { channel, info, active, following, onPlay, onStop, onTracklist, onFollow } =
		props
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
					<button type="button" className={css.button} onClick={onTracklist}>
						Tracklist
					</button>
					{now?.showAlias ? (
						<button
							type="button"
							className={classnames(css.button, { [css.buttonActive]: following })}
							onClick={onFollow}
							title="Notify me when this show starts"
						>
							{following ? "Following" : "Follow"}
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
	following: string[]
	onPlay: (source: Source) => void
	onStop: () => void
	onTracklist: (channel: 1 | 2) => void
	onFollow: (alias: string) => void
}

export function LiveView(props: LiveProps) {
	const { live, source, following, onPlay, onStop, onTracklist, onFollow } = props

	return (
		<>
			<h1 className={css.heading}>Live now</h1>
			<div className={css.channels}>
				{([1, 2] as const).map(function (id) {
					const info = id === 1 ? live?.channel1 : live?.channel2
					const alias = info?.now.showAlias ?? ""
					return (
						<ChannelCard
							key={id}
							channel={id}
							info={info}
							active={sameSource(source, { kind: "channel", id })}
							following={Boolean(alias) && following.includes(alias)}
							onPlay={() => onPlay({ kind: "channel", id })}
							onStop={onStop}
							onTracklist={() => onTracklist(id)}
							onFollow={() => alias && onFollow(alias)}
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
	onPlay: (source: Source) => void
	onStop: () => void
}

export function MixtapesView(props: MixtapesProps) {
	const { mixtapes, loading, source, onPlay, onStop } = props

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
							onClick={
								active
									? onStop
									: () => onPlay({ kind: "mixtape", alias: mixtape.alias })
							}
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
	onOpen: (url: string) => void
}

export function SearchView(props: SearchProps) {
	const { query, onQuery, state, onOpen } = props
	const pasted = isShowURL(query)

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
			</div>

			{pasted ? (
				<p className={css.empty}>
					That is a show link. Press Open to load it.
				</p>
			) : null}
			{state.loading ? <p className={css.empty}>Searching…</p> : null}
			{state.error ? <p className={css.empty}>Search failed.</p> : null}
			{!state.loading && !state.error && query.trim().length >= 2 && !pasted && state.results.length === 0 ? (
				<p className={css.empty}>Nothing found.</p>
			) : null}

			<div className={css.grid}>
				{state.results.map(function (result) {
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
									result.image ? { backgroundImage: `url(${result.image})` } : undefined
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

type ArchiveProps = {
	show: ArchiveShow | null
	playing: boolean
	onToggle: () => void
}

export function ArchiveView(props: ArchiveProps) {
	const { show, playing, onToggle } = props

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

const STATUS_LABEL: Record<PlayerStatus, string> = {
	idle: "Stopped",
	connecting: "Connecting",
	playing: "Live",
	reconnecting: "Reconnecting",
	failed: "Stream unavailable",
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
	mixtapeFormat: "mp3" | "aac"
	onMixtapeFormat: (format: "mp3" | "aac") => void
	canChooseFormat: boolean
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

			const ratio = window.devicePixelRatio || 1
			const width = el.clientWidth
			const h = el.clientHeight
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
					c.bezierCurveTo(mid, y(values[i - 1]), mid, y(values[i]), cx, y(values[i]))
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
		mixtapeFormat,
		onMixtapeFormat,
		canChooseFormat,
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

			<HealthGraph health={health} height={detailed ? 62 : 34} />
			<div className={css.graphLabel}>
				Buffer ahead · last {window}s · {health.buffered.toFixed(1)}s now
			</div>

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
						<Stat
							label="Served by"
							value={reported?.station || "-"}
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

					{outputs.length > 0 ? (
						<label className={css.output}>
							<span className={css.compareLabel}>Output</span>
							<select
								className={css.select}
								value={outputDevice}
								onChange={(e) => onOutputDevice(e.target.value)}
							>
								<option value="">System default</option>
								{outputs
									.filter((o) => o.id !== "default")
									.map((o) => (
										<option key={o.id} value={o.id}>
											{o.label}
										</option>
									))}
							</select>
						</label>
					) : null}

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
	mixtapeFormat: "mp3" | "aac"
	onMixtapeFormat: (format: "mp3" | "aac") => void
	canChooseFormat: boolean
	status: PlayerStatus
	playing: boolean
	volume: number
	onToggle: () => void
	onVolume: (volume: number) => void
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
		mixtapeFormat,
		onMixtapeFormat,
		canChooseFormat,
		status,
		playing,
		volume,
		onToggle,
		onVolume,
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
			<div className={css.fullTop}>
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
					{now.genres.length > 0 ? (
						<div className={css.tags}>
							{now.genres.slice(0, 6).map((g) => (
								<span key={g} className={css.tag}>
									{g}
								</span>
							))}
						</div>
					) : null}
					<div className={css.fullControls}>
						<button type="button" className={css.button} onClick={onToggle}>
							{playing ? "Stop" : "Play"}
						</button>
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
						mixtapeFormat={mixtapeFormat}
						onMixtapeFormat={onMixtapeFormat}
						canChooseFormat={canChooseFormat}
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
	onToggle: () => void
	onVolume: (volume: number) => void
	onMute: () => void
	onChannel: (id: 1 | 2) => void
	onExpand: () => void
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
		onToggle,
		onVolume,
		onMute,
		onChannel,
		onExpand,
	} = props
	const { title, subtitle, image } = now

	// Compact, and only ever what the frames proved.
	const measured = probe?.measured
	const format = measured
		? `${measured.bitrate}k ${measured.codec.includes("Layer III") ? "MP3" : measured.codec}`
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
			{format ? <div className={css.barFormat}>{format}</div> : null}
			<div className={css.status}>
				<StatusDot status={status} />
				{STATUS_LABEL[status]}
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
