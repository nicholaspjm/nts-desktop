import EventEmitter from "node:events"
import path from "node:path"
import bplist from "bplist-parser"
import {
	BrowserWindow,
	type IpcMainEvent,
	type IpcMainInvokeEvent,
	Menu,
	type NativeImage,
	Notification,
	Tray,
	app,
	dialog,
	globalShortcut,
	ipcMain,
	nativeImage,
	shell,
	webFrameMain,
} from "electron"
import serve from "electron-serve"

import { type CastDevice, CastDiscovery, type CastMedia, CastSession } from "./cast"
import * as credentials from "./credentials"
import * as diagnostics from "./diagnostics"
import {
	hookFrame,
	installPermissionHandlers,
	isPlayerFrame,
	routeFrames,
} from "./frame-audio"
import * as history from "./history"
import { NTSLiveTracks } from "./live-tracks"
import * as preferences from "./preferences"
import { show } from "./show"
import { probeStream } from "./stream-probe"
import { checkForUpdate } from "./updates"

import appIcon from "../logos/logo.png"
import menubarOne from "../logos/menu-one.png"
import menubarTwo from "../logos/menu-two.png"
import menubar from "../logos/menu.png"

const loadURL = serve({ directory: "client" })

// Closing the window normally just hides it so playback survives. This flips
// once the user genuinely quits, letting the window close for real.
let quitting = false

export class NTSApplication {
	window: BrowserWindow
	tray: Tray
	evts: EventEmitter
	production: boolean
	liveTracks: NTSLiveTracks
	castDiscovery: CastDiscovery
	castSession: CastSession | null = null
	// Bounds to put back when leaving the mini player, and whether it is on.
	mini = false
	// Bumped per open so a slow show cannot land after a newer one was asked for.
	private openRequest = 0
	// The label of the chosen output device. A label rather than an id because
	// the players are cross-origin and ids do not survive that boundary.
	private outputLabel = ""
	// Repeated crashes in a short window mean reloading is not helping.
	private crashes = 0
	private lastCrash = 0
	private normalBounds: Electron.Rectangle | null = null

	constructor(production: boolean) {
		this.window = makeWindow()
		this.tray = makeTray()
		this.evts = new EventEmitter()
		this.production = production
		this.liveTracks = new NTSLiveTracks(this.window.webContents)
		this.castDiscovery = new CastDiscovery((devices) => {
			this.send("cast-devices", devices)
		})
	}

	/** Sends to the renderer only while there is a live window to receive it. */
	private send(channel: string, payload: unknown): void {
		if (!this.window.isDestroyed()) {
			this.window.webContents.send(channel, payload)
		}
	}

	async init() {
		this.tray.on("click", () => this.toggle())
		this.tray.on("right-click", () => this.openMenu())

		// @ts-expect-error: only supported on macOS
		this.tray.on("drop-text", (_evt: IpcMainEvent, url: string) => this.openURL(url))

		// @ts-expect-error: only supported on macOS
		this.tray.on("drop-files", (_evt: IpcMainEvent, files: string[]) =>
			this.openFile(files[0]),
		)

		this.evts.on("error", (message: string) => this.showNotification(message))

		ipcMain.on("init", this.syncPreferences.bind(this))

		ipcMain.on("close", () => this.close())
		ipcMain.on("my-nts", () => this.openMyNTS())
		ipcMain.on("explore", () => this.openExplore())
		ipcMain.on("playing", this.handlePlaying.bind(this))
		ipcMain.on("chat", (_evt: IpcMainEvent, channel: number) =>
			this.openChat(channel),
		)
		ipcMain.on("preferences", (_evt: IpcMainEvent, prefs: preferences.Preferences) =>
			this.storePreferences(prefs),
		)

		// The window has no frame, so its controls live in the renderer.
		ipcMain.on("window", (_evt: IpcMainEvent, action: string) => {
			if (action === "minimize") {
				this.window.minimize()
				return
			}
			if (action === "maximize") {
				if (this.window.isMaximized()) {
					this.window.unmaximize()
				} else {
					this.window.maximize()
				}
				return
			}
			if (action === "close") {
				this.close()
				return
			}
			if (action === "mini") {
				this.toggleMini()
			}
		})

		// Read the broadcast parameters from the stream's ICY headers. This has to
		// happen in the main process: the relay's 302 carries no CORS headers, so
		// the renderer cannot read them, and requesting them from there in CORS
		// mode breaks the audio load outright.
		ipcMain.handle("stream-info", (_evt: IpcMainInvokeEvent, url: string) =>
			probeStream(url),
		)

		// Casting. Discovery only runs while someone is looking at the list, so
		// the app is not holding a multicast socket open for a feature most
		// sessions never use.
		ipcMain.handle("cast-discover", () => {
			this.castDiscovery.start()
			return this.castDiscovery.list()
		})

		ipcMain.on("cast-rescan", () => this.castDiscovery.rescan())

		ipcMain.handle(
			"cast-start",
			(_evt: IpcMainInvokeEvent, deviceId: string, media: CastMedia) => {
				const device = this.castDiscovery
					.list()
					.find((d: CastDevice) => d.id === deviceId)
				if (!device) {
					return {
						started: false,
						reason: "that device is no longer on the network",
					}
				}
				this.startCast(device, media)
				return { started: true }
			},
		)

		ipcMain.on("cast-stop", () => this.stopCast())

		// Routes the embedded players to the chosen output. The renderer sends the
		// device's label rather than its id, because ids are salted per origin and
		// the app's id means nothing inside the player's frame.
		ipcMain.on("frame-output", (_evt: IpcMainEvent, label: string) => {
			this.outputLabel = label
			this.applyFrameOutput()
		})

		// The local element is not in the audio path while casting, so the app's
		// own volume control has to reach the device or it silently does nothing.
		ipcMain.on(
			"cast-volume",
			(_evt: IpcMainEvent, level: number, muted: boolean) => {
				this.castSession?.setVolume(level, muted)
			},
		)

		// Releases the multicast socket when the picker closes. Holding it open
		// for the rest of the session was the thing making discovery on-demand
		// was supposed to avoid.
		ipcMain.on("cast-discover-stop", () => {
			if (!this.castSession) {
				this.castDiscovery.stop()
			}
		})

		// Search results and the paste box both land here. openURL already
		// validates that it is an nts.live show URL.
		ipcMain.on("open-url", (_evt: IpcMainEvent, url: string) => this.openURL(url))

		ipcMain.on(
			"notify",
			(_evt: IpcMainEvent, payload: { title: string; body: string }) => {
				new Notification({ title: payload.title, body: payload.body }).show()
			},
		)

		// Only ever hand the browser links to NTS or to the services that actually
		// host the archive audio.
		const EXTERNAL_ALLOWED = [
			"https://www.nts.live/",
			"https://nts.live/",
			"https://www.mixcloud.com/",
			"https://mixcloud.com/",
			"https://soundcloud.com/",
			"https://www.soundcloud.com/",
		]
		ipcMain.on("open-external", (_evt: IpcMainEvent, url: string) => {
			if (EXTERNAL_ALLOWED.some((prefix) => url.startsWith(prefix))) {
				shell.openExternal(url)
			}
		})

		// Listening history, recorded from the renderer since only it knows what
		// is actually playing.
		ipcMain.on(
			"history-add",
			(_evt: IpcMainEvent, entry: { name: string; kind: string; detail?: string }) =>
				history.add({
					name: entry.name,
					kind:
						entry.kind === "mixtape" || entry.kind === "channel"
							? entry.kind
							: "archive",
					detail: entry.detail,
				}),
		)
		ipcMain.handle("history", () => history.read())
		ipcMain.on("history-clear", () => history.clear())

		// Reports only: nothing is downloaded or installed.
		ipcMain.handle("update-check", () => checkForUpdate(app.getVersion()))

		ipcMain.on("report-problem", () =>
			shell.openExternal("https://github.com/nicholaspjm/nts-desktop/issues/new"),
		)
		ipcMain.on("open-releases", () =>
			shell.openExternal(
				"https://github.com/nicholaspjm/nts-desktop/releases/latest",
			),
		)
		ipcMain.on("open-logs", () => shell.showItemInFolder(diagnostics.logPath()))

		ipcMain.on("schedule", () => this.openSchedule())
		ipcMain.on("reload", () => this.reload())
		ipcMain.on("quit", () => app.quit())

		// @ts-expect-error: only supported on macOS
		app.on("open-file", (_evt: IpcMainEvent, filename: string) =>
			this.openFile(filename),
		)
		app.on("before-quit", () => {
			quitting = true
		})
		app.on("will-quit", () => {
			globalShortcut.unregisterAll()
			// Leaves the device playing on purpose: it fetches the stream itself,
			// so quitting the app is no reason to silence the speaker. Only the
			// local resources are released.
			this.castDiscovery.stop()
		})
		app.on("activate", () => this.open())

		globalShortcut.register("Control+N", () => this.toggle())

		// No File/Edit/View strip: those actions live behind the overflow menu.
		// macOS is different: removing the application menu also removes Cmd+Q,
		// Cmd+W and clipboard shortcuts, so keep a standard minimal one there.
		Menu.setApplicationMenu(mac ? makeAppMenu() : null)

		// A dead renderer left a black window and no way back, which for an app
		// whose point is not stopping is the worst state it can be in. Reloading
		// costs the current view and whatever was playing, but a listener can
		// press play again; they cannot revive a blank window.
		// Has to be in place before any player frame loads, since it decides what
		// the frame is allowed to see.
		installPermissionHandlers()

		// Hooked as early as the frame can be reached, because the widget's audio
		// has to be captured as it is constructed rather than found afterwards.
		this.window.webContents.on(
			"did-frame-navigate",
			(_evt, _url, _code, _status, isMainFrame, processId, frameRoutingId) => {
				if (isMainFrame) {
					return
				}
				const frame = webFrameMain.fromId(processId, frameRoutingId)
				if (!frame || !isPlayerFrame(frame)) {
					return
				}
				hookFrame(frame).then(() => this.applyFrameOutput())
			},
		)

		this.window.webContents.on("render-process-gone", (_evt, details) => {
			diagnostics.record(
				"renderer gone",
				`reason=${details.reason} exitCode=${details.exitCode}`,
			)

			// Reloading straight into the same crash would spin forever, so give
			// up after a few in quick succession and leave the window alone with
			// the reason written to the log.
			const now = Date.now()
			if (now - this.lastCrash > CRASH_WINDOW) {
				this.crashes = 0
			}
			this.lastCrash = now
			this.crashes += 1

			if (this.crashes > CRASH_LIMIT) {
				diagnostics.record(
					"renderer gone",
					`crashed ${this.crashes} times in quick succession, not reloading again`,
				)
				return
			}

			this.window.webContents.reload()
		})
		this.window.webContents.on("unresponsive", () => {
			diagnostics.record("renderer unresponsive", "window stopped responding")
		})
		this.window.webContents.on("preload-error", (_evt, preloadPath, error) => {
			diagnostics.record("preload error", `${preloadPath}: ${error?.message}`)
		})

		await this.liveTracks.init()
		await this.loadClient()

		// A real app window, so show it on launch rather than waiting for a click
		// on a tray icon Windows tends to bury in the overflow flyout anyway.
		this.open()
	}

	login() {
		this.window.webContents.send("login")
		this.open()
	}

	async loadClient() {
		if (this.production) {
			await loadURL(this.window)
			this.window.loadURL("app://-")
		} else {
			this.window.loadURL("http://localhost:5173")
		}
	}

	isOpen() {
		return this.window.isVisible()
	}

	/**
	 * Hands a device the stream URL and watches what it does with it.
	 *
	 * Any existing session is stopped first: two receivers playing the same
	 * radio station a few seconds apart is worse than either alone.
	 */
	startCast(device: CastDevice, media: CastMedia): void {
		this.stopCast()

		this.castSession = new CastSession(device, media, (state) => {
			this.send("cast-state", state)
		})
		this.castSession.start()
	}

	stopCast(): void {
		this.castSession?.stop()
		this.castSession = null
	}

	/**
	 * Shrinks to a small always-on-top strip, and back.
	 *
	 * The app this grew out of was a 360x270 popup, and that shape is genuinely
	 * better when the radio is background listening rather than the thing being
	 * looked at. It is a mode rather than a replacement: the full window is still
	 * one click away, and its size and position are put back exactly.
	 *
	 * The main process owns this rather than the renderer, because the window is
	 * the thing being changed and two sources of truth for "is it small" would
	 * drift the moment either side missed a message.
	 */
	toggleMini(): void {
		this.mini = !this.mini

		if (this.mini) {
			this.normalBounds = this.window.getBounds()

			// The floor has to come down before the size can, or setBounds is
			// silently clamped to the full window's minimum and nothing happens.
			this.window.setMinimumSize(MINI_WIDTH, MINI_HEIGHT)
			this.window.setResizable(false)
			this.window.setMaximizable(false)

			// Keep it near where the window was rather than jumping to a corner,
			// while making sure it stays on a screen the user can actually see.
			const previous = this.normalBounds
			this.window.setBounds({
				x: previous.x,
				y: previous.y,
				width: MINI_WIDTH,
				height: MINI_HEIGHT,
			})

			// The point of a mini player is that it stays visible over the work
			// being done, which is exactly what the popup did.
			this.window.setAlwaysOnTop(true, "floating")
		} else {
			this.window.setAlwaysOnTop(false)
			this.window.setResizable(true)
			this.window.setMaximizable(true)
			this.window.setMinimumSize(MAIN_MIN_WIDTH, MAIN_MIN_HEIGHT)

			if (this.normalBounds) {
				this.window.setBounds(this.normalBounds)
				this.normalBounds = null
			}
		}

		this.send("mini", this.mini)
	}

	/**
	 * Points every embedded player at the chosen output device.
	 *
	 * Retried briefly because a widget that is still loading has not created the
	 * thing that carries its audio yet. The hook applies the choice to anything
	 * built after this runs, so the retries only have to cover a frame that was
	 * not yet reachable at all.
	 */
	applyFrameOutput(attempt = 0): void {
		if (this.window.isDestroyed()) {
			return
		}

		void routeFrames(this.window.webContents, this.outputLabel)

		if (attempt < FRAME_OUTPUT_TRIES) {
			setTimeout(() => this.applyFrameOutput(attempt + 1), FRAME_OUTPUT_DELAY)
		}
	}

	close() {
		this.window.webContents.send("close")
		setTimeout(() => this.window.hide(), 10)
		this.liveTracks.unsubscribe?.()
	}

	handlePlaying(_evt: IpcMainEvent, channel: 1 | 2 | string | null) {
		if (channel === 1 || channel === 2) {
			this.setIcon(channel)
			return
		}
		this.clearIcon()
	}

	setIcon(channel: 1 | 2) {
		const icon = makeIcon(channel === 1 ? menubarOne : menubarTwo)
		this.tray.setImage(icon)
	}

	clearIcon() {
		const icon = makeIcon(menubar)
		this.tray.setImage(icon)
	}

	open() {
		this.window.webContents.send("open")

		// This is an ordinary application window now, so it keeps whatever size
		// and position the user left it at. No tray-relative placement, which was
		// never reliable across displays running at different scale factors.
		if (this.window.isMinimized()) {
			this.window.restore()
		}

		this.window.show()
		this.window.focus()
		this.liveTracks.subscribe()
		this.liveTracks.sync()
	}

	async syncPreferences() {
		const prefs = await preferences.read()
		this.window.webContents.send("preferences", prefs)
		this.window.webContents.send("preferences", prefs)
		this.window.webContents.send("preferences", prefs)
	}

	toggle() {
		if (this.isOpen()) {
			this.close()
		} else {
			this.open()
		}
	}

	reload() {
		this.window.reload()
		this.liveTracks.subscribe()
	}

	async openMenu() {
		this.close()
		const menu = await makeMenu(this)
		this.tray.popUpContextMenu(menu)
	}

	async openFile(filename: string) {
		if (!filename.endsWith(".webloc")) {
			this.evts.emit("error", "NTS Desktop can only open .webloc files")
			return
		}

		const content = await bplist.parseFile(filename)
		const url = content[0].URL
		app.addRecentDocument(filename)
		this.openURL(url)
	}

	async openURL(url: string) {
		if (!url.startsWith("https://www.nts.live/shows/")) {
			this.evts.emit("error", "Please use a valid NTS show URL")
			return
		}

		// Only the most recent request may deliver. Opening a show takes long
		// enough to notice, which is long enough to click a second one, and
		// without this the answer that arrives last wins rather than the one that
		// was asked for last. That is not a rare race: a slower show reliably
		// overwrites a faster one clicked after it, so the wrong show loads every
		// time that pairing comes up.
		this.openRequest += 1
		const request = this.openRequest

		// Told immediately so the click has a visible effect. The renderer cannot
		// work this out for itself: the fetch happens here, and until now the only
		// thing it ever heard about was the finished result.
		this.send("opening-show", url)

		let data: Awaited<ReturnType<typeof show>>
		try {
			data = await show(url)
		} catch (err) {
			if (request === this.openRequest) {
				this.send("open-show-failed", url)
				this.evts.emit("error", "That show could not be loaded")
			}
			return
		}

		if (request !== this.openRequest) {
			return
		}

		// Deliberately after the staleness check. History is a record of what the
		// user actually opened, and an abandoned show that lost the race was never
		// looked at.
		history.add({ name: data.name, kind: "archive", url })
		this.send("open-show", data)
	}

	async browse() {
		const { filePaths, canceled } = await dialog.showOpenDialog({
			message: "Select a link to an archive show",
			properties: ["openFile"],
			filters: [{ name: "links", extensions: ["webloc"] }],
		})

		if (canceled) {
			return
		}

		this.openFile(filePaths[0])
	}

	showNotification(message: string) {
		const notification = new Notification({
			body: message,
			silent: true,
		})
		notification.show()
	}

	openAbout() {
		shell.openExternal("https://github.com/romeovs/nts-desktop")
	}

	openMyNTS() {
		shell.openExternal("https://www.nts.live/my-nts/favourites/shows")
	}

	openExplore() {
		shell.openExternal("https://www.nts.live/explore")
	}

	openChat(channel: number) {
		if (channel === 1) {
			shell.openExternal(
				"https://discord.com/channels/909834111592591421/933364043459227708",
			)
		} else {
			shell.openExternal(
				"https://discord.com/channels/909834111592591421/935528991501209600",
			)
		}
	}

	openSchedule() {
		shell.openExternal("https://www.nts.live/schedule")
	}

	async storePreferences(prefs: Partial<preferences.Preferences>) {
		const old = await preferences.read()
		await preferences.write({
			...old,
			...prefs,
		})
	}
}

const mac = process.platform === "darwin"

function makeAppMenu(): Menu {
	return Menu.buildFromTemplate([
		{ role: "appMenu" },
		{ role: "editMenu" },
		{ role: "viewMenu" },
		{ role: "windowMenu" },
	])
}

// The mini player's size, and the full window's floor. The floor has to be
// lowered before the window can shrink past it, so both live here.
// The original popup's exact dimensions. The layout is a reconstruction of it,
// and the proportions are part of the look: artwork fills the window, so a
// different aspect ratio crops it differently.
// How long a crash counts as "recent", and how many reloads to attempt inside
// that window before concluding the reload is part of the problem.
// The embedded widgets create their media element well after the frame exists,
// so one attempt lands too early.
const FRAME_OUTPUT_TRIES = 6
const FRAME_OUTPUT_DELAY = 1_000

const CRASH_WINDOW = 60_000
const CRASH_LIMIT = 3

const MINI_WIDTH = 360
const MINI_HEIGHT = 270
const MAIN_MIN_WIDTH = 880
const MAIN_MIN_HEIGHT = 560

function makeWindow(): BrowserWindow {
	// A normal application window, not the old 360x270 frameless popup that was
	// pinned to a screen corner and vanished the moment it lost focus.
	const window = new BrowserWindow({
		width: 1100,
		height: 720,
		minWidth: MAIN_MIN_WIDTH,
		minHeight: MAIN_MIN_HEIGHT,
		show: false,
		// Chromeless. On macOS keep the frame so the traffic lights survive and
		// inset them into our own title bar; elsewhere draw the controls ourselves.
		...(mac
			? {
					titleBarStyle: "hiddenInset" as const,
					trafficLightPosition: { x: 13, y: 10 },
				}
			: { frame: false }),
		resizable: true,
		backgroundColor: "#111111",
		title: "NTS Desktop",
		icon: nativeImage.createFromPath(path.resolve(__dirname, appIcon)),
		paintWhenInitiallyHidden: true,
		webPreferences: {
			backgroundThrottling: false,
			webSecurity: true,
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			preload: path.resolve(__dirname, "preload.js"),
		},
	})

	// Closing the window keeps the app alive in the tray so audio continues.
	window.on("close", function (evt) {
		if (quitting) {
			return
		}
		evt.preventDefault()
		window.hide()
	})

	return window
}

function makeIcon(filename: string): NativeImage {
	const filepath = path.resolve(__dirname, filename)
	const original = nativeImage.createFromPath(filepath)
	const size = original.getSize()
	const ratio = size.width / size.height
	const height = process.platform === "darwin" ? 18 : 16
	const icon = original.resize({
		height,
		width: Math.round(height * ratio * 10) / 10,
	})

	if (process.platform === "darwin") {
		icon.setTemplateImage(true)
		return icon
	}

	// Template images are a macOS concept: the OS recolours them to suit the
	// menubar. Windows does no such thing, so this black-on-transparent logo
	// renders as black on a dark taskbar and is effectively invisible. Invert
	// the colour channels to white, respecting premultiplied alpha so the
	// antialiased edges don't blow out.
	const bitmap = icon.toBitmap()
	for (let i = 0; i < bitmap.length; i += 4) {
		const alpha = bitmap[i + 3]
		bitmap[i] = alpha - bitmap[i]
		bitmap[i + 1] = alpha - bitmap[i + 1]
		bitmap[i + 2] = alpha - bitmap[i + 2]
	}

	return nativeImage.createFromBitmap(bitmap, icon.getSize())
}

function makeTray(): Tray {
	const icon = makeIcon(menubar)
	const tray = new Tray(icon)
	tray.setIgnoreDoubleClickEvents(true)
	tray.setToolTip("NTS Desktop")
	return tray
}

async function makeMenu(application: NTSApplication): Promise<Menu> {
	const h = await history.read()
	const hasCredentials = await credentials.has()

	return Menu.buildFromTemplate([
		{
			label: "About NTS Desktop",
			click: () => application.openAbout(),
		},
		{
			label: "Show NTS Desktop",
			accelerator: "Control+N",
			acceleratorWorksWhenHidden: true,
			click: () => application.open(),
		},
		{ type: "separator" },
		{
			label: "Open Schedule...",
			click: () => application.openSchedule(),
		},
		{
			label: "Open Favourites...",
			click: () => application.openMyNTS(),
		},
		{ type: "separator" },
		{
			label: "Load Archive Show...",
			click: () => application.browse(),
		},
		{
			label: "Recently Listened Archive Shows",
			submenu: [
				// History also records live and mixtape plays now, and those have no
				// page to reopen, so only archive entries belong in this menu.
				...h
					.filter((entry) => entry.kind === "archive" && entry.url)
					.map((entry) => ({
						label: entry.name,
						click: () => void application.openURL(entry.url as string),
					})),
				{
					type: "separator",
				},
				{
					label: "Clear",
					enabled: h.length > 0,
					click: () => history.clear(),
				},
			],
		},
		{ type: "separator" },
		!hasCredentials
			? {
					label: "Log in to get live tracks...",
					click: () => application.login(),
				}
			: {
					label: "Log out",
					click: () => application.liveTracks.logout(),
				},
		{ type: "separator" },
		{
			label: "Reload NTS Desktop",
			click: () => application.reload(),
		},
		{ label: "Quit NTS Desktop", role: "quit" },
	])
}
