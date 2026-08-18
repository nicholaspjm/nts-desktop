import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import "./global.css"

import { streams } from "~/lib/stream"

import { electron } from "./electron"
import { useLiveInfo } from "./lib/live"
import { useMixtapes } from "./lib/mixtapes"
import { usePreferences } from "./lib/preferences"
import { useStreamHealth, useStreamInfo } from "./lib/stream-info"
import { useEvent } from "./lib/use-event"
import { useKeydown } from "./lib/use-keydown"
import { useOffline } from "./lib/use-offline"

import { useMetadata } from "./metadata"

import type { ShowInfo as ArchiveShow } from "../app/show"
import { Help } from "./help"
import { Login } from "./login"
import { Mixcloud } from "./mixcloud"
import { Notifications } from "./notifications"
import { Offline } from "./offline"
import { Player, type PlayerStatus } from "./player"
import {
	FullScreen,
	LiveView,
	type MenuAction,
	MixtapesView,
	Nav,
	type NowPlaying,
	NowPlayingBar,
	ScheduleView,
	type Source,
	TitleBar,
	type View,
	type WindowAction,
	sameSource,
} from "./shell"
import { Soundcloud } from "./soundcloud"
import { Splash } from "./splash"

import css from "./shell.module.css"

export function App() {
	const [route, setRoute] = useState<"app" | "login">("app")

	useEvent("login", () => setRoute("login"), [setRoute])
	useEvent("close", () => setRoute("app"), [setRoute])

	const handleLoginClose = useCallback(function () {
		setRoute("app")
	}, [])

	return (
		<>
			<NTS />
			<Login onClose={handleLoginClose} show={route === "login"} />
			<Notifications />
		</>
	)
}

export function NTS() {
	const [view, setView] = useState<View>("live")

	// The single source the audio pipeline is pointed at. null means stopped,
	// which keeps "what is selected" and "is it playing" from drifting apart.
	const [active, setActive] = useState<Source | null>(null)
	const [status, setStatus] = useState<PlayerStatus>("idle")

	const [show, setShow] = useState<ArchiveShow | null>(null)
	const [position, setPosition] = useState(0)
	const [looped, setLooped] = useState(0)
	const [archivePlaying, setArchivePlaying] = useState(false)
	const [isShowingHelp, setIsShowingHelp] = useState(false)
	const [isFullScreen, setIsFullScreen] = useState(false)
	const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null)
	const [detailedStream, setDetailedStream] = useState(false)

	const { preferences, updatePreferences } = usePreferences()
	const isOffline = useOffline()
	const live = useLiveInfo({ skip: isOffline })
	const mix = useMixtapes()

	const channel = active?.kind === "channel" ? active.id : null
	useMetadata(archivePlaying ? "show" : channel, show, live)

	const mixtape = useMemo(
		function () {
			if (active?.kind !== "mixtape") {
				return null
			}
			return mix.data.find((m) => m.alias === active.alias) ?? null
		},
		[active, mix.data],
	)

	// The URL handed to the single <Player>. Switching this reconnects.
	const src = useMemo(
		function () {
			if (!active) {
				return null
			}
			if (active.kind === "channel") {
				return streams[active.id]
			}
			return mixtape?.stream ?? null
		},
		[active, mixtape],
	)

	const play = useCallback(
		function (source: Source) {
			if (isOffline) {
				return
			}
			setArchivePlaying(false)
			setActive(source)
		},
		[isOffline],
	)

	const stop = useCallback(function () {
		setActive(null)
	}, [])

	const toggle = useCallback(
		function () {
			if (active) {
				stop()
				return
			}
			play({ kind: "channel", id: 1 })
		},
		[active, play, stop],
	)

	const toggleChannel = useCallback(
		function (id: 1 | 2) {
			if (sameSource(active, { kind: "channel", id })) {
				stop()
				return
			}
			play({ kind: "channel", id })
		},
		[active, play, stop],
	)

	const setVolume = useCallback(
		function (volume: number) {
			updatePreferences((prefs) => ({ ...prefs, volume }))
		},
		[updatePreferences],
	)

	const nudgeVolume = useCallback(
		function (delta: number) {
			updatePreferences((prefs) => ({
				...prefs,
				volume: clamp(0, 1, prefs.volume + delta),
			}))
		},
		[updatePreferences],
	)

	// Drives the tray icon in the main process.
	useEffect(
		function () {
			electron.send("playing", channel ?? (active ? "mixtape" : null))
		},
		[channel, active],
	)

	useEffect(
		function () {
			if (isOffline) {
				setActive(null)
			}
		},
		[isOffline],
	)

	useKeydown(" ", toggle, [toggle])
	useKeydown("1", () => toggleChannel(1), [toggleChannel])
	useKeydown("2", () => toggleChannel(2), [toggleChannel])
	useKeydown("?", () => setIsShowingHelp((x) => !x))
	useKeydown("+", () => nudgeVolume(0.1), [nudgeVolume])
	useKeydown("-", () => nudgeVolume(-0.1), [nudgeVolume])
	useKeydown("ArrowUp", () => nudgeVolume(0.1), [nudgeVolume])
	useKeydown("ArrowDown", () => nudgeVolume(-0.1), [nudgeVolume])

	useEvent("open-show", async function (next: ArchiveShow) {
		setShow(next)
		setActive(null)
		setArchivePlaying(true)
		setPosition(0)
		setLooped(0)
	})

	const handleTracklist = useCallback(function (id: 1 | 2) {
		electron.send("tracklist", id)
	}, [])

	const handleMenu = useCallback(function (action: MenuAction) {
		electron.send(action)
	}, [])

	const handleWindow = useCallback(function (action: WindowAction) {
		electron.send("window", action)
	}, [])

	const streamInfo = useStreamInfo(src)
	// Only a genuine reconnect counts. The first connect is not a recovery.
	const health = useStreamHealth(audioEl, Boolean(active), status === "reconnecting")

	const now = useMemo(
		function (): NowPlaying {
			if (!active) {
				return {
					title: "Nothing playing",
					subtitle: "Pick a channel or a mixtape",
					image: "",
					description: "",
					genres: [],
					starts: null,
					ends: null,
				}
			}

			if (active.kind === "mixtape") {
				return {
					title: mixtape?.title ?? "Mixtape",
					subtitle: mixtape?.subtitle ?? "Infinite Mixtape",
					image: mixtape?.image ?? "",
					description: mixtape?.description ?? "",
					genres: [],
					starts: null,
					ends: null,
				}
			}

			const info = active.id === 1 ? live.data?.channel1 : live.data?.channel2
			const show = info?.now
			return {
				title: show?.name ?? `Channel ${active.id}`,
				subtitle: show?.location
					? `NTS ${active.id} - ${show.location}`
					: `NTS ${active.id}`,
				image: show?.image ?? "",
				description: show?.description ?? "",
				genres: show?.genres ?? [],
				starts: show?.starts ?? null,
				ends: show?.ends ?? null,
			}
		},
		[active, live.data, mixtape],
	)

	return (
		<>
			<Splash hide={!live.loading} />
			<div className={css.shell}>
				<TitleBar onAction={handleMenu} onWindow={handleWindow} />
				<Nav view={view} onView={setView} />
				<main className={css.content}>
					{view === "live" ? (
						<LiveView
							live={live.data}
							source={active}
							onPlay={play}
							onStop={stop}
							onTracklist={handleTracklist}
						/>
					) : null}
					{view === "mixtapes" ? (
						<MixtapesView
							mixtapes={mix.data}
							loading={mix.loading}
							source={active}
							onPlay={play}
							onStop={stop}
						/>
					) : null}
					{view === "schedule" ? <ScheduleView live={live.data} /> : null}
				</main>
				<NowPlayingBar
					now={now}
					status={status}
					playing={Boolean(active)}
					volume={preferences.volume}
					onToggle={toggle}
					onVolume={setVolume}
					onExpand={() => setIsFullScreen(true)}
				/>
			</div>

			{isFullScreen ? (
				<FullScreen
					now={now}
					probe={streamInfo.probe}
					probeLoading={streamInfo.loading}
					health={health}
					detailed={detailedStream}
					onDetailed={setDetailedStream}
					status={status}
					playing={Boolean(active)}
					volume={preferences.volume}
					onToggle={toggle}
					onVolume={setVolume}
					onClose={() => setIsFullScreen(false)}
				/>
			) : null}

			<Player
				src={src}
				playing={Boolean(active)}
				onPlay={() => {}}
				onStop={() => {}}
				onStatus={setStatus}
				onElement={setAudioEl}
				volume={preferences.volume}
			/>

			{show?.source?.source === "mixcloud" && (
				<Mixcloud
					key={`${show?.source?.url}_${looped}_mixcloud`}
					show={show}
					playing={archivePlaying}
					onPlay={() => setArchivePlaying(true)}
					onStop={() => setArchivePlaying(false)}
					onLoad={() => {}}
					onProgress={(pos: number) => setPosition(Math.round(pos))}
					position={position}
					volume={preferences.volume}
				/>
			)}
			{show?.source?.source === "soundcloud" && (
				<Soundcloud
					key={`${show?.source?.url}_soundcloud`}
					show={show}
					playing={archivePlaying}
					onPlay={() => setArchivePlaying(true)}
					onStop={() => setArchivePlaying(false)}
					onLoad={() => {}}
					onProgress={(pos: number) => setPosition(Math.round(pos))}
					position={position}
					volume={preferences.volume}
				/>
			)}

			<Offline hide={!isOffline} />
			<Help hide={!isShowingHelp} onHide={() => setIsShowingHelp(false)} />
		</>
	)
}

function clamp(min: number, max: number, number: number): number {
	return Math.min(max, Math.max(min, number))
}
