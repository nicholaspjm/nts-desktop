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
import { type ExploreFilters, useExplore, useTaxonomy } from "./lib/explore"
import { useLiveInfo } from "./lib/live"
import { useMixtapes } from "./lib/mixtapes"
import { useAudioOutput, useAudioOutputs, useReconcileOutput } from "./lib/outputs"
import { usePreferences } from "./lib/preferences"
import { type SortOrder, useSearch } from "./lib/search"
import type { SeekRequest } from "./lib/seek"
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
	ExploreView,
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

// What the archive's back link says, by where the show was opened from.
const BACK_LABELS: Record<View, string> = {
	live: "Live",
	explore: "Explore",
	mixtapes: "Mixtapes",
	schedule: "Schedule",
	search: "Search",
	history: "History",
	archive: "Search",
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
	// The URL of a show that has been asked for but has not arrived. Held so the
	// archive view can say it is working rather than sitting on the previous
	// show's details, which read as the click having done nothing.
	const [opening, setOpening] = useState<string | null>(null)
	// The show being listened to, as opposed to the one being looked at. They
	// were the same thing, so opening a second show to read its details tore down
	// the player that was mid-way through the first.
	const [playingShow, setPlayingShow] = useState<ArchiveShow | null>(null)
	// What the transport should pick up again after a stop. Survives stopping,
	// which is the whole point: stop then play should resume, not start
	// something else. "archive" stands for whatever playingShow holds.
	const [lastPlayed, setLastPlayed] = useState<Source | "archive" | null>(null)
	const [position, setPosition] = useState(0)
	// What the user asked for, as opposed to where playback has got to. See
	// lib/seek.ts: these used to be the same value, which made a player's own
	// progress reports look like requests to move.
	const [seek, setSeek] = useState<SeekRequest | null>(null)
	const seekId = useRef(0)
	// Reported by the embedded players once they are ready. Zero means nothing is
	// loaded yet, which is what the scrub bar keys off.
	const [duration, setDuration] = useState(0)
	const [looped, setLooped] = useState(0)
	// What was asked for. Drives the embedded player.
	const [archivePlaying, setArchivePlaying] = useState(false)
	// What the embedded player reports back. The two differ for the seconds an
	// iframe takes to load and start, which is long enough that claiming to be
	// playing throughout reads as the app having ignored the click.
	const [archiveLive, setArchiveLive] = useState(false)
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
			// The archive player's length and position belong to the show that was
			// playing, and the scrub bar keys off the length. Left set, a live
			// channel inherited a slider for something no longer playing.
			setArchivePlaying(false)
			setArchiveLive(false)
			setPosition(0)
			setDuration(0)
			setActive(source)
			setLastPlayed(source)
		},
		[isOffline],
	)

	const stop = useCallback(function () {
		setActive(null)
		setArchivePlaying(false)
		setArchiveLive(false)
	}, [])

	const toggle = useCallback(
		function () {
			// Archive shows play through the embedded players rather than the
			// stream, so they are invisible to `active` and have to be checked
			// separately. Without this the transport starts channel 1 over the top
			// of a show that is already playing.
			if (archivePlaying) {
				setArchivePlaying(false)
				return
			}
			if (active) {
				stop()
				return
			}

			// Nothing is playing, so this is a resume. Starting channel 1 whatever
			// had been stopped made the button destructive: stop and play were not
			// each other's opposite.
			if (lastPlayed === "archive" && playingShow) {
				setArchiveLive(false)
				setArchivePlaying(true)
				return
			}
			if (lastPlayed && lastPlayed !== "archive") {
				play(lastPlayed)
				return
			}

			// Nothing has played yet this session.
			play({ kind: "channel", id: 1 })
		},
		[active, archivePlaying, lastPlayed, play, playingShow, stop],
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

	// Remembered when a show is opened, so the archive can send you back where
	// you came from rather than stranding you on a view with no exit.
	const [cameFrom, setCameFrom] = useState<View>("search")

	// Read through a ref because useEvent registers its handler once, so a
	// handler closing over `view` would see it as it was on the first render,
	// which is always "live". That is why the way back said Live wherever you
	// had actually come from.
	const viewRef = useRef(view)
	viewRef.current = view

	// Same reason as viewRef: the open-show handler is registered once and would
	// otherwise read whatever `opening` was on first render, which is always null.
	const openingRef = useRef(opening)
	openingRef.current = opening

	// Opening a show only changes what is on screen. Nothing about playback is
	// touched: whatever was playing keeps playing until something is actually
	// asked to start, which is what lets you read one show while hearing another.
	// Sent the moment the click is heard, before anything is fetched. Switching
	// the view here rather than on arrival is what makes the click register: the
	// tile the user came from is no longer on screen, so there is nothing to
	// click a second time by mistake while the show loads.
	useEvent("opening-show", function (url: string) {
		const from = viewRef.current
		setCameFrom((prev) => (from === "archive" ? prev : from))
		setOpening(url)
		setView("archive")
	})

	// Opening a show only changes what is on screen. Nothing about playback is
	// touched: whatever was playing keeps playing until something is actually
	// asked to start, which is what lets you read one show while hearing another.
	useEvent("open-show", async function (next: ArchiveShow) {
		const from = viewRef.current
		setCameFrom((prev) => (from === "archive" ? prev : from))
		// Whether the user is still waiting for this. Backing out of the loading
		// screen clears it, and someone who has walked away should not be dragged
		// back to a show they gave up on a moment later. The details are still
		// kept, so the Archive tab has them if they want to look.
		const wanted = openingRef.current !== null
		setOpening(null)
		setShow(next)
		if (wanted) {
			setView("archive")
		}
	})

	// The main process only reports a failure for the show still being waited on,
	// so this cannot clear a load that has since been superseded.
	useEvent("open-show-failed", function () {
		setOpening(null)
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
	// The main process owns whether the window is small, since it is the thing
	// doing the resizing. This just follows.
	const [mini, setMini] = useState(false)
	useEffect(function () {
		return electron.addListener("mini", function (_evt: Event, on: boolean) {
			setMini(on)
		})
	}, [])

	const toggleMini = useCallback(function () {
		electron.send("window", "mini")
	}, [])

	useKeydown("m", () => setMuted((x) => !x))
	useKeydown("f", () => setIsFullScreen((x) => !x))
	useKeydown("n", toggleMini, [toggleMini])

	// One way back out of every mode, in the order they sit on top of each
	// other. The shell is hidden behind the mini player, so anything open in it
	// is unreachable until that closes.
	useKeydown(
		"Escape",
		function () {
			if (mini) {
				toggleMini()
				return
			}
			if (isShowingHelp) {
				setIsShowingHelp(false)
				return
			}
			if (isFullScreen) {
				setIsFullScreen(false)
			}
		},
		[mini, isShowingHelp, isFullScreen, toggleMini],
	)

	const handleWindow = useCallback(function (action: WindowAction) {
		electron.send("window", action)
	}, [])

	const search = useSearch(query)

	const [exploreFilters, setExploreFilters] = useState<ExploreFilters>({
		mood: null,
		genres: [],
	})

	// Latched rather than tracking the current view: nothing is requested until
	// Explore is opened for the first time, and leaving and coming back does not
	// throw away what was already loaded.
	const [exploreOpened, setExploreOpened] = useState(false)
	useEffect(
		function () {
			if (view === "explore") {
				setExploreOpened(true)
			}
		},
		[view],
	)

	const taxonomy = useTaxonomy(exploreOpened)
	const explore = useExplore(exploreFilters, exploreOpened)
	const { outputs, refresh: refreshOutputs } = useAudioOutputs()

	useAudioOutput(audioEl, preferences.outputDevice)

	// The embedded players are cross-origin, so the renderer cannot route them.
	// The main process can, and is asked to whenever the choice or the show
	// changes. Sending on both is deliberate: a device chosen mid-show has to
	// reach the player that is already running, and a show started later has to
	// pick up the choice already made.
	//
	// The label goes over rather than the id, because device ids are salted per
	// origin: the id held here does not name the same device inside the player's
	// frame, and passing it there rejects with NotFoundError.
	const outputLabel = useMemo(
		function () {
			if (preferences.outputDevice === "") {
				return ""
			}
			return outputs.find((o) => o.id === preferences.outputDevice)?.label ?? null
		},
		[outputs, preferences.outputDevice],
	)

	useEffect(
		function () {
			// null means the device list has not caught up with the saved choice yet.
			// Sending now would route to the default and look like the setting had
			// been ignored, so it waits for the list instead.
			if (!playingShow || outputLabel === null) {
				return
			}
			electron.send("frame-output", outputLabel)
		},
		[outputLabel, playingShow],
	)

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
	// One vocabulary for three transports. An archive show that has been asked
	// for but has not reported back is "connecting", exactly as a stream that has
	// not begun is, so the dot and the label already know what to do with it.
	const displayStatus: PlayerStatus = armed
		? castState.status === "buffering"
			? "connecting"
			: castState.status
		: archivePlaying
			? archiveLive
				? "playing"
				: "connecting"
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

	// Whether the show on screen is the one making sound. Identified by its audio
	// source, since that is what the embedded player is keyed on.
	const viewingPlayingShow =
		Boolean(show?.source?.url) && show?.source?.url === playingShow?.source?.url

	const toggleArchive = useCallback(
		function () {
			if (viewingPlayingShow) {
				setArchivePlaying(function (on) {
					if (on) {
						setArchiveLive(false)
					}
					return !on
				})
				return
			}
			// A different show: hand the player over to it, and start from the top
			// rather than wherever the last one had got to.
			setActive(null)
			setPlayingShow(show)
			setPosition(0)
			setDuration(0)
			setLooped(0)
			setArchiveLive(false)
			setArchivePlaying(true)
			setLastPlayed("archive")
		},
		[show, viewingPlayingShow],
	)

	// Stable, because the embedded players list these in their effect
	// dependencies. Passed inline they were a new function every render, which
	// tore the widget down and rebuilt it continuously.
	const handleArchivePlay = useCallback(function () {
		setArchiveLive(true)
	}, [])

	const handleArchiveStop = useCallback(function () {
		setArchiveLive(false)
	}, [])

	// Progress is proof. The play event alone was not enough to trust, and this
	// is the same reasoning the stream watchdog uses: what the position does is
	// more reliable than what the player says about itself.
	const handleArchiveProgress = useCallback(function (pos: number) {
		setPosition(Math.round(pos))
		setArchiveLive(true)
	}, [])

	// Moves the thumb straight away so the scrub bar stays under the finger, and
	// records the request separately for the player to act on.
	const requestSeek = useCallback(function (to: number) {
		seekId.current += 1
		setPosition(to)
		setSeek({ to, id: seekId.current })
	}, [])

	const now = useMemo(
		function (): NowPlaying {
			// Archive shows play through the embedded players and never touch
			// `active`, so without this the bar read "Nothing playing" over a show
			// that was audibly playing.
			// Also when it is paused. A show that has been stopped is still the thing
			// loaded, and replacing it with "Nothing playing" threw away what the
			// listener had chosen and where they had got to.
			if (playingShow && !active) {
				return {
					title: playingShow.name,
					subtitle: playingShow.location
						? `Archive · ${playingShow.location}`
						: "Archive",
					image: playingShow.image,
					description: "",
					genres: playingShow.genres,
					moods: playingShow.moods,
					location: playingShow.location,
					showAlias: "",
					starts: null,
					ends: null,
				}
			}

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
			const onAir = info?.now
			return {
				title: onAir?.name ?? `Channel ${active.id}`,
				subtitle: onAir?.location
					? `NTS ${active.id} - ${onAir.location}`
					: `NTS ${active.id}`,
				image: onAir?.image ?? "",
				description: onAir?.description ?? "",
				genres: onAir?.genres ?? [],
				moods: onAir?.moods ?? [],
				location: onAir?.location ?? "",
				showAlias: onAir?.showAlias ?? "",
				starts: onAir?.starts ?? null,
				ends: onAir?.ends ?? null,
			}
		},
		[active, live.data, mixtape, playingShow],
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
					outputs={outputs}
					outputDevice={preferences.outputDevice}
					onOutputDevice={setOutputDevice}
					onRefreshOutputs={refreshOutputs}
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
				/>
				<Nav
					view={view}
					onView={setView}
					hasArchive={Boolean(show) || opening !== null}
				/>
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
					{view === "explore" ? (
						<ExploreView
							taxonomy={taxonomy}
							filters={exploreFilters}
							onFilters={setExploreFilters}
							state={explore}
							onOpen={(url) => electron.send("open-url", url)}
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
							loading={opening !== null}
							backLabel={BACK_LABELS[cameFrom]}
							onBack={() => {
								setOpening(null)
								setView(cameFrom)
							}}
							playing={archivePlaying && viewingPlayingShow}
							starting={viewingPlayingShow && archivePlaying && !archiveLive}
							position={viewingPlayingShow ? position : 0}
							duration={viewingPlayingShow ? duration : 0}
							onSeek={requestSeek}
							onToggle={toggleArchive}
							onOriginal={(url) => electron.send("open-external", url)}
						/>
					) : null}
				</main>
				<NowPlayingBar
					now={now}
					probe={streamInfo.probe}
					status={displayStatus}
					playing={playing}
					position={position}
					duration={duration}
					onSeek={requestSeek}
					onOpenPlaying={
						playingShow
							? function () {
									setShow(playingShow)
									setCameFrom(viewRef.current)
									setView("archive")
								}
							: undefined
					}
					statusLabel={
						archivePlaying
							? archiveLive
								? "Playing"
								: "Loading"
							: playingShow && !active
								? "Paused"
								: undefined
					}
					paused={Boolean(playingShow) && !active && !archivePlaying}
					volume={preferences.volume}
					muted={muted}
					source={active}
					onChannel={toggleChannel}
					health={health}
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
					archive={archivePlaying ? playingShow : null}
					onOpenUrl={(url) => electron.send("open-external", url)}
					status={displayStatus}
					playing={playing}
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
					playing={playing}
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

			{playingShow?.source?.source === "mixcloud" && (
				<Mixcloud
					key={`${playingShow?.source?.url}_${looped}_mixcloud`}
					show={playingShow}
					playing={archivePlaying}
					onPlay={handleArchivePlay}
					onStop={handleArchiveStop}
					onLoad={setDuration}
					onProgress={handleArchiveProgress}
					seek={seek}
					volume={preferences.volume}
				/>
			)}
			{playingShow?.source?.source === "soundcloud" && (
				<Soundcloud
					key={`${playingShow?.source?.url}_soundcloud`}
					show={playingShow}
					playing={archivePlaying}
					onPlay={handleArchivePlay}
					onStop={handleArchiveStop}
					onLoad={setDuration}
					onProgress={handleArchiveProgress}
					seek={seek}
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
