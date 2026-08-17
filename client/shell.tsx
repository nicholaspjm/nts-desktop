import classnames from "classnames"

import type { ChannelInfo, Info, ShowInfo } from "./lib/live"
import type { Mixtape } from "./lib/mixtapes"
import type { PlayerStatus } from "./player"

import css from "./shell.module.css"

// What the single audio pipeline is pointed at.
export type Source =
	| { kind: "channel"; id: 1 | 2 }
	| { kind: "mixtape"; alias: string }

export type View = "live" | "mixtapes" | "schedule"

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

type NavProps = {
	view: View
	onView: (view: View) => void
	onChat: () => void
}

export function Nav(props: NavProps) {
	const { view, onView, onChat } = props

	const items: Array<{ id: View; label: string }> = [
		{ id: "live", label: "Live" },
		{ id: "mixtapes", label: "Mixtapes" },
		{ id: "schedule", label: "Schedule" },
	]

	return (
		<nav className={css.nav}>
			<div className={css.brand}>NTS</div>
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
			<button type="button" className={css.navItem} onClick={onChat}>
				Chat
			</button>
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

type BarProps = {
	title: string
	subtitle: string
	image: string
	status: PlayerStatus
	playing: boolean
	volume: number
	onToggle: () => void
	onVolume: (volume: number) => void
}

export function NowPlayingBar(props: BarProps) {
	const { title, subtitle, image, status, playing, volume, onToggle, onVolume } =
		props

	return (
		<div className={css.bar}>
			<div
				className={css.barArt}
				style={image ? { backgroundImage: `url(${image})` } : undefined}
			/>
			<div className={css.barText}>
				<div className={css.barTitle}>{title}</div>
				<div className={css.barSub}>{subtitle}</div>
			</div>
			<div className={css.status}>
				<span
					className={classnames(css.dot, {
						[css.dotPlaying]: status === "playing",
						[css.dotWarn]: status === "connecting" || status === "reconnecting",
						[css.dotError]: status === "failed",
					})}
				/>
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
