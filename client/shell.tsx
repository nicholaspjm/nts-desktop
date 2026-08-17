import classnames from "classnames"
import { useEffect, useRef, useState } from "react"

import logo from "../logos/menu.svg"

import type { ChannelInfo, Info, ShowInfo } from "./lib/live"
import type { Mixtape } from "./lib/mixtapes"
import type { StreamHealth, StreamInfo } from "./lib/stream-info"
import type { PlayerStatus } from "./player"

import css from "./shell.module.css"

// What the single audio pipeline is pointed at.
export type Source =
	| { kind: "channel"; id: 1 | 2 }
	| { kind: "mixtape"; alias: string }

export type View = "live" | "mixtapes" | "schedule"

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
		<header className={css.titlebar}>
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

			<div className={css.windowControls}>
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
}

export function Nav(props: NavProps) {
	const { view, onView } = props

	const items: Array<{ id: View; label: string }> = [
		{ id: "live", label: "Live" },
		{ id: "mixtapes", label: "Mixtapes" },
		{ id: "schedule", label: "Schedule" },
	]

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
	onTracklist: () => void
}

export function ChannelCard(props: ChannelCardProps) {
	const { channel, info, active, onPlay, onStop, onTracklist } = props
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
	onTracklist: (channel: 1 | 2) => void
}

export function LiveView(props: LiveProps) {
	const { live, source, onPlay, onStop, onTracklist } = props

	return (
		<>
			<h1 className={css.heading}>Live now</h1>
			<div className={css.channels}>
				{([1, 2] as const).map(function (id) {
					return (
						<ChannelCard
							key={id}
							channel={id}
							info={id === 1 ? live?.channel1 : live?.channel2}
							active={sameSource(source, { kind: "channel", id })}
							onPlay={() => onPlay({ kind: "channel", id })}
							onStop={onStop}
							onTracklist={() => onTracklist(id)}
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
	info: StreamInfo | null
	loading: boolean
	health: StreamHealth
	status: PlayerStatus
}

function HealthGraph(props: { health: StreamHealth }) {
	const { health } = props
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
			const height = el.clientHeight
			el.width = Math.round(width * ratio)
			el.height = Math.round(height * ratio)
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
			ctx.clearRect(0, 0, width, height)

			const points = health.history
			if (points.length === 0) {
				return
			}

			// Scale to the largest buffer seen, with a floor so a healthy flat line
			// doesn't fill the whole graph and look alarming.
			const peak = Math.max(4, ...points.map((p) => p.buffered))
			const step = width / Math.max(1, points.length - 1)

			ctx.beginPath()
			ctx.moveTo(0, height)
			points.forEach(function (point, i) {
				const x = i * step
				const y = height - (point.buffered / peak) * (height - 2)
				ctx.lineTo(x, y)
			})
			ctx.lineTo((points.length - 1) * step, height)
			ctx.closePath()
			ctx.fillStyle = "rgba(230, 0, 45, 0.18)"
			ctx.fill()

			ctx.beginPath()
			points.forEach(function (point, i) {
				const x = i * step
				const y = height - (point.buffered / peak) * (height - 2)
				if (i === 0) {
					ctx.moveTo(x, y)
				} else {
					ctx.lineTo(x, y)
				}
			})
			ctx.strokeStyle = "#e6002d"
			ctx.lineWidth = 1.5
			ctx.stroke()

			// Mark every moment the watchdog was reconnecting.
			ctx.fillStyle = "rgba(255, 176, 46, 0.85)"
			points.forEach(function (point, i) {
				if (point.reconnecting) {
					ctx.fillRect(i * step - 1, 0, 2, height)
				}
			})
		},
		[health],
	)

	return <canvas className={css.graph} ref={canvas} />
}

function Stat(props: { label: string; value: string }) {
	return (
		<div className={css.stat}>
			<div className={css.statLabel}>{props.label}</div>
			<div className={css.statValue}>{props.value}</div>
		</div>
	)
}

export function StreamPanel(props: PanelProps) {
	const { info, loading, health, status } = props

	const quality =
		info?.bitrate != null
			? `${info.bitrate} kbps ${info.codec}`.trim()
			: loading
				? "Reading…"
				: "Unknown"

	const minutes = Math.floor(health.uptime / 60)
	const seconds = health.uptime % 60

	return (
		<section className={css.panel}>
			<div className={css.panelHead}>
				<span className={css.heading}>Stream</span>
				<span className={css.panelQuality}>{quality}</span>
			</div>

			<HealthGraph health={health} />
			<div className={css.graphLabel}>
				Buffer ahead, last {Math.round((health.history.length * 500) / 1000)}s
			</div>

			<div className={css.stats}>
				<Stat label="Buffered" value={`${health.buffered.toFixed(1)}s`} />
				<Stat
					label="Sample rate"
					value={info?.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : "-"}
				/>
				<Stat label="Codec" value={info?.codec || "-"} />
				<Stat label="State" value={STATUS_LABEL[status]} />
				<Stat
					label="Uptime"
					value={minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}
				/>
				<Stat label="Reconnects" value={String(health.reconnects)} />
			</div>

			{info?.edge ? (
				<div className={css.panelFoot}>
					{info.station ? `${info.station} · ` : ""}
					{info.edge}
				</div>
			) : null}
		</section>
	)
}

type FullProps = {
	now: NowPlaying
	info: StreamInfo | null
	infoLoading: boolean
	health: StreamHealth
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
		info,
		infoLoading,
		health,
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
						info={info}
						loading={infoLoading}
						health={health}
						status={status}
					/>
				</div>
			</div>
		</div>
	)
}

type BarProps = {
	now: NowPlaying
	status: PlayerStatus
	playing: boolean
	volume: number
	onToggle: () => void
	onVolume: (volume: number) => void
	onExpand: () => void
}

export function NowPlayingBar(props: BarProps) {
	const { now, status, playing, volume, onToggle, onVolume, onExpand } = props
	const { title, subtitle, image } = now

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
			<div className={css.status}>
				<StatusDot status={status} />
				{STATUS_LABEL[status]}
			</div>
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
	)
}
