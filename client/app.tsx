import classnames from "classnames"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import "./global.css"

import { hlsStreams, streams } from "~/lib/stream"

import { electron } from "./electron"
import {
	setCastVolume,
	startCast,
	stopCast,
	useCastDevices,
	useCastState,
} from "./lib/cast"
import {
	useHistory,
	useMediaKeys,
	useSleepTimer,
	useUpdateCheck,
} from "./lib/controls"
import { useLiveInfo } from "./lib/live"
import { useMixtapes } from "./lib/mixtapes"
import { useAudioOutput, useAudioOutputs, useReconcileOutput } from "./lib/outputs"
import { usePreferences } from "./lib/preferences"
import { type SortOrder, useSearch } from "./lib/search"
import {
	useOutputSampleRate,
	useStreamHealth,
	useStreamInfo,
} from "./lib/stream-info"
import { useEvent } from "./lib/use-event"
import { useKeydown } from "./lib/use-keydown"
import { useOffline } from "./lib/use-offline"

import { useMetadata } from "./metadata"

import type { ShowInfo as ArchiveShow } from "../app/show"
import { Help } from "./help"
import { Mixcloud } from "./mixcloud"
import { Notifications } from "./notifications"
import { Offline } from "./offline"
import { Player, type PlayerStatus } from "./player"
import {
	ArchiveView,
	FullScreen,
	HistoryView,
	LiveView,
	type MenuAction,
	MiniPlayer,
	MixtapeDetail,
	MixtapesView,
	Nav,
	type NowPlaying,
	NowPlayingBar,
	ScheduleView,
	SearchView,
	type Source,
	TitleBar,
	type View,
	type WindowAction,
	sameSource,
} from "./shell"
import { Soundcloud } from "./soundcloud"
import { Splash } from "./splash"

import css from "./shell.module.css"

/**
 * The plain MP3 equivalent of a live HLS URL.
 *
 * Handed to a Cast device as a second chance: if a receiver refuses HLS with
 * MP3 segments, an ordinary MP3 stream over HTTP is the most universally
 * supported thing it can be given, so the refusal need not be a dead end.
 */
function directFallback(
	url: string,
): { url: string; contentType: string } | undefined {
	for (const id of [1, 2] as const) {
		if (url === hlsStreams[id]) {
			return { url: streams[id], contentType: "audio/mpeg" }
		}
	}
	return undefined
}

export function App() {
	return (
		<>
			<NTS />
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
	const [query, setQuery] = useState("")
	const [muted, setMuted] = useState(false)
	const [sortOrder, setSortOrder] = useState<SortOrder>("relevance")
	// Which mixtape is being looked at, as distinct from which is playing.
	const [openMixtape, setOpenMixtape] = useState<string | null>(null)
	// Bumped to re-read history after something is played or cleared.
	const [historyKey, setHistoryKey] = useState(0)
	// Multiplier applied over the stored volume during a sleep fade, so the
	// user's chosen level is never overwritten.
	const [fade, setFade] = useState(1)

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
				// HLS by default: it buffers tens of seconds instead of two, which is
				// what keeps a network stutter from being audible.
				return preferences.liveDelivery === "direct"
					? streams[active.id]
					: hlsStreams[active.id]
			}
			if (!mixtape) {
				return null
			}
			// Fall back to the direct MP3 if this mixtape has no AAC variant.
			if (preferences.mixtapeFormat === "aac" && mixtape.streamAac) {
				return mixtape.streamAac
			}
			return mixtape.stream
		},
		[active, mixtape, preferences.mixtapeFormat, preferences.liveDelivery],
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

	const playing = Boolean(active) || archivePlaying

	useMediaKeys(playing, toggle, stop)

	const sleep = useSleepTimer(playing, stop, setFade)

	const history = useHistory(historyKey)
	const update = useUpdateCheck()

	// Record what is playing, once it is actually playing.
	useEffect(
		function () {
			if (!active) {
				return
			}
			if (active.kind === "mixtape") {
				if (!mixtape) {
					return
				}
				electron.send("history-add", {
					name: mixtape.title,
					kind: "mixtape",
					detail: mixtape.subtitle,
				})
			} else {
				const info = active.id === 1 ? live.data?.channel1 : live.data?.channel2
				if (!info) {
					return
				}
				electron.send("history-add", {
					name: info.now.name,
					kind: "channel",
					detail: info.now.location
						? `NTS ${active.id} · ${info.now.location}`
						: `NTS ${active.id}`,
				})
			}
			setHistoryKey((k) => k + 1)
		},
		[active, mixtape, live.data],
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
		// Land on the details rather than starting playback: the user asked for
		// this thing, they have not yet asked to hear it.
		setArchivePlaying(false)
		setView("archive")
		setPosition(0)
		setLooped(0)
	})

	// Opens the episode currently on air, falling back to the show's own page if
	// the API has not given this broadcast an episode alias yet.
	const openOnNTS = useCallback(
		function (id: 1 | 2) {
			const info = id === 1 ? live.data?.channel1 : live.data?.channel2
			const show = info?.now
			if (!show?.showAlias) {
				return
			}
			const url = show.episodeAlias
				? `https://www.nts.live/shows/${show.showAlias}/episodes/${show.episodeAlias}`
				: `https://www.nts.live/shows/${show.showAlias}`
			electron.send("open-external", url)
		},
		[live.data],
	)

	const openArchive = useCallback(function (url: string) {
		electron.send("open-url", url)
	}, [])

	const handleMenu = useCallback(function (action: MenuAction) {
		electron.send(action)
	}, [])

	// The window is the thing being changed, so this goes down the window
	// channel rather than being treated as an ordinary menu command.
	const toggleMini = useCallback(function () {
		electron.send("window", "mini")
	}, [])

	// The main process owns whether the window is small, since it is the thing
	// doing the resizing. This just follows.
	const [mini, setMini] = useState(false)
	useEffect(function () {
		return electron.addListener("mini", function (_evt: Event, on: boolean) {
			setMini(on)
		})
	}, [])

	const handleWindow = useCallback(function (action: WindowAction) {
		electron.send("window", action)
	}, [])

	const search = useSearch(query)
	const { outputs, refresh: refreshOutputs } = useAudioOutputs()

	useAudioOutput(audioEl, preferences.outputDevice)

	const forgetOutputDevice = useCallback(
		function () {
			updatePreferences((prefs) => ({ ...prefs, outputDevice: "" }))
		},
		[updatePreferences],
	)
	useReconcileOutput(outputs, preferences.outputDevice, forgetOutputDevice)

	const {
		devices: castDevices,
		discover: discoverCast,
		idle: idleCast,
		rescan: rescanCast,
	} = useCastDevices()
	const castState = useCastState()

	// Deliberately not persisted. Reopening the app and having it silently seize
	// a speaker in another room would be a surprise, and remembering the choice
	// would also mean running device discovery at every launch.
	const [castTarget, setCastTarget] = useState<string | null>(null)

	// "Armed" is a device having been chosen; "casting" is a device actually
	// holding the stream. They are not the same, and conflating them made every
	// indicator claim a cast was happening when nothing had been handed over.
	const armed = castTarget !== null
	const casting = armed && castState.device !== null

	// While a device is playing, the local element is idle by design, so its
	// status would read "idle" and look broken. The device's own state is the
	// truthful answer to "is this playing", and it maps onto the same vocabulary
	// the status dot and label already speak.
	const displayStatus: PlayerStatus = armed
		? castState.status === "buffering"
			? "connecting"
			: castState.status
		: status

	// Opening the cast menu is the first point at which browsing the network is
	// justified, since that is when someone is actually looking for a device.
	const handleOpenCast = useCallback(
		function () {
			discoverCast()
		},
		[discoverCast],
	)

	const handleStopCast = useCallback(function () {
		setCastTarget(null)
	}, [])

	// The local element is not in the audio path while casting, so its volume is
	// meaningless. Without this the slider moves, the mute button lights up, and
	// the speaker in the other room carries on regardless.
	useEffect(
		function () {
			if (!armed) {
				return
			}
			setCastVolume(muted ? 0 : preferences.volume, muted)
		},
		[armed, muted, preferences.volume],
	)

	const setMixtapeFormat = useCallback(
		function (mixtapeFormat: "mp3" | "aac") {
			updatePreferences((prefs) => ({ ...prefs, mixtapeFormat }))
		},
		[updatePreferences],
	)

	const setLiveDelivery = useCallback(
		function (liveDelivery: "hls" | "direct") {
			updatePreferences((prefs) => ({ ...prefs, liveDelivery }))
		},
		[updatePreferences],
	)

	const setOutputDevice = useCallback(
		function (outputDevice: string) {
			updatePreferences((prefs) => ({ ...prefs, outputDevice }))
		},
		[updatePreferences],
	)

	// Probe the direct stream even when playing HLS: the probe decodes MPEG
	// frames, and an .m3u8 is a playlist, so pointing it at the playlist would
	// report nothing. Same audio either way, so the figures still describe what
	// is being heard.
	const probeSrc = useMemo(
		function () {
			if (active?.kind === "channel") {
				return streams[active.id]
			}
			return src
		},
		[active, src],
	)
	const streamInfo = useStreamInfo(probeSrc)
	const outputSampleRate = useOutputSampleRate(preferences.outputDevice)
	// Only a genuine reconnect counts. The first connect is not a recovery.
	const health = useStreamHealth(
		audioEl,
		Boolean(active) && !armed,
		status === "reconnecting",
	)

	const now = useMemo(
		function (): NowPlaying {
			if (!active) {
				return {
					title: "Nothing playing",
					subtitle: "Pick a channel or a mixtape",
					image: "",
					description: "",
					genres: [],
					moods: [],
					location: "",
					showAlias: "",
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
					moods: [],
					location: "",
					showAlias: "",
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
				moods: show?.moods ?? [],
				location: show?.location ?? "",
				showAlias: show?.showAlias ?? "",
				starts: show?.starts ?? null,
				ends: show?.ends ?? null,
			}
		},
		[active, live.data, mixtape],
	)

	// Held in a ref so a show change does not restart the cast. Re-issuing LOAD
	// is the only way to update what the device displays, and it interrupts the
	// audio, which is a bad trade for a title that is right either way.
	const nowRef = useRef(now)
	nowRef.current = now

	// Hand the device the stream URL and let it fetch the audio itself. That is
	// what makes casting worth having: the stream reaches the speaker untouched
	// and keeps playing whatever this machine does afterwards.
	useEffect(
		function () {
			if (!castTarget || !src) {
				return
			}

			const meta = nowRef.current
			const isHls = src.includes(".m3u8")

			startCast(castTarget, {
				url: src,
				contentType: isHls ? "application/vnd.apple.mpegurl" : "audio/mpeg",
				// NTS delivers HLS as MP3 segments, where a receiver would otherwise
				// assume AAC and refuse them.
				...(isHls ? { hlsSegmentFormat: "mp3" as const } : {}),
				...(isHls ? { fallback: directFallback(src) } : {}),
				title: meta.title,
				subtitle: meta.subtitle,
				image: meta.image,
			}).then(function (result) {
				if (!result.started) {
					// Falling back to local playback beats sitting in silence while
					// every indicator insists a device has it.
					console.warn("could not cast:", result.reason)
					setCastTarget(null)
				}
			})

			return function () {
				stopCast()
			}
		},
		[castTarget, src],
	)

	return (
		<>
			<Splash hide={!live.loading} />
			{/* Hidden rather than unmounted. The mini player is a different view of
			    the same session, and tearing the shell down would drop the schedule,
			    the search, the scroll position and everything else the moment
			    someone shrank the window. */}
			<div className={classnames(css.shell, { [css.hidden]: mini })}>
				<TitleBar
					onAction={handleMenu}
					onWindow={handleWindow}
					onMini={toggleMini}
					update={update}
				/>
				<Nav view={view} onView={setView} hasArchive={Boolean(show)} />
				<main className={css.content}>
					{view === "live" ? (
						<LiveView
							live={live.data}
							source={active}
							onPlay={play}
							onStop={stop}
							onOpenNTS={openOnNTS}
						/>
					) : null}
					{view === "mixtapes" ? (
						openMixtape && mix.data.some((m) => m.alias === openMixtape) ? (
							<MixtapeDetail
								mixtape={
									mix.data.find(
										(m) => m.alias === openMixtape,
									) as (typeof mix.data)[0]
								}
								playing={sameSource(active, {
									kind: "mixtape",
									alias: openMixtape,
								})}
								onPlay={() => play({ kind: "mixtape", alias: openMixtape })}
								onStop={stop}
								onBack={() => setOpenMixtape(null)}
							/>
						) : (
							<MixtapesView
								mixtapes={mix.data}
								loading={mix.loading}
								source={active}
								onSelect={setOpenMixtape}
							/>
						)
					) : null}
					{view === "schedule" ? <ScheduleView live={live.data} /> : null}
					{view === "history" ? (
						<HistoryView
							entries={history}
							onOpen={openArchive}
							onClear={() => {
								electron.send("history-clear")
								setHistoryKey((k) => k + 1)
							}}
						/>
					) : null}
					{view === "search" ? (
						<SearchView
							query={query}
							onQuery={setQuery}
							state={search}
							order={sortOrder}
							onOrder={setSortOrder}
							onOpen={openArchive}
						/>
					) : null}
					{view === "archive" ? (
						<ArchiveView
							show={show}
							playing={archivePlaying}
							onToggle={() => setArchivePlaying((x) => !x)}
							onOriginal={(url) => electron.send("open-external", url)}
						/>
					) : null}
				</main>
				<NowPlayingBar
					now={now}
					probe={streamInfo.probe}
					status={displayStatus}
					playing={Boolean(active)}
					volume={preferences.volume}
					muted={muted}
					source={active}
					onChannel={toggleChannel}
					health={health}
					outputs={outputs}
					outputDevice={preferences.outputDevice}
					onOutputDevice={setOutputDevice}
					castDevices={castDevices}
					castTarget={castTarget}
					castingNow={casting}
					canCast={src !== null}
					castStatus={castState.status}
					castError={castState.error}
					onOpenCast={handleOpenCast}
					onCloseCast={idleCast}
					onCast={setCastTarget}
					onStopCast={handleStopCast}
					onRescanCast={rescanCast}
					onToggle={toggle}
					onVolume={(v) => {
						setMuted(false)
						setVolume(v)
					}}
					onMute={() => setMuted((m) => !m)}
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
					outputs={outputs}
					outputDevice={preferences.outputDevice}
					onOutputDevice={setOutputDevice}
					onRefreshOutputs={refreshOutputs}
					mixtapeFormat={preferences.mixtapeFormat}
					onMixtapeFormat={setMixtapeFormat}
					canChooseFormat={Boolean(mixtape?.streamAac)}
					liveDelivery={preferences.liveDelivery}
					onLiveDelivery={setLiveDelivery}
					sleepRemaining={sleep.remaining}
					onSleep={sleep.set}
					onCancelSleep={sleep.cancel}
					outputSampleRate={outputSampleRate}
					casting={armed}
					status={displayStatus}
					playing={Boolean(active)}
					volume={preferences.volume}
					onToggle={toggle}
					onVolume={setVolume}
					onShowPage={(alias) =>
						electron.send("open-external", `https://www.nts.live/shows/${alias}`)
					}
					onClose={() => setIsFullScreen(false)}
				/>
			) : null}

			{mini ? (
				<MiniPlayer
					now={now}
					source={active}
					status={displayStatus}
					playing={Boolean(active)}
					onToggle={toggle}
					onExpand={toggleMini}
					onClose={() => handleWindow("close")}
				/>
			) : null}

			<Player
				src={armed ? null : src}
				playing={Boolean(active) && !armed}
				onPlay={() => {}}
				onStop={() => {}}
				onStatus={setStatus}
				onElement={setAudioEl}
				volume={muted ? 0 : preferences.volume * fade}
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
