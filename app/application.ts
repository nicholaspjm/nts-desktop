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
} from "electron"
import serve from "electron-serve"

import * as credentials from "./credentials"
import * as history from "./history"
import { NTSLiveTracks } from "./live-tracks"
import * as preferences from "./preferences"
import { show } from "./show"
import { probeStream } from "./stream-probe"

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
	tracklist: BrowserWindow | null = null
	tray: Tray
	evts: EventEmitter
	production: boolean
	liveTracks: NTSLiveTracks

	constructor(production: boolean) {
		this.window = makeWindow()
		this.tray = makeTray()
		this.evts = new EventEmitter()
		this.production = production
		this.liveTracks = new NTSLiveTracks(this.window.webContents)
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
		ipcMain.on("tracklist", (_evt: IpcMainEvent, channel: number | string) =>
			this.openTracklist(channel),
		)
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
			}
		})

		// Read the broadcast parameters from the stream's ICY headers. This has to
		// happen in the main process: the relay's 302 carries no CORS headers, so
		// the renderer cannot read them, and requesting them from there in CORS
		// mode breaks the audio load outright.
		ipcMain.handle("stream-info", (_evt: IpcMainInvokeEvent, url: string) =>
			probeStream(url),
		)

		// Search results and the paste box both land here. openURL already
		// validates that it is an nts.live show URL.
		ipcMain.on("open-url", (_evt: IpcMainEvent, url: string) => this.openURL(url))

		ipcMain.on(
			"notify",
			(_evt: IpcMainEvent, payload: { title: string; body: string }) => {
				new Notification({ title: payload.title, body: payload.body }).show()
			},
		)

		ipcMain.on("open-external", (_evt: IpcMainEvent, url: string) => {
			// Only ever hand nts.live links to the system browser.
			if (url.startsWith("https://www.nts.live/")) {
				shell.openExternal(url)
			}
		})

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
		app.on("will-quit", () => globalShortcut.unregisterAll())
		app.on("activate", () => this.open())

		globalShortcut.register("Control+N", () => this.toggle())

		// No File/Edit/View strip: those actions live behind the overflow menu.
		// macOS is different: removing the application menu also removes Cmd+Q,
		// Cmd+W and clipboard shortcuts, so keep a standard minimal one there.
		Menu.setApplicationMenu(mac ? makeAppMenu() : null)

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

		const data = await show(url)
		history.add({ name: data.name, url })
		this.window.webContents.send("open-show", data)
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

	openTracklist(channel: number | string) {
		const url = `https://www.nts.live/live-tracklist/${channel}`

		if (this.tracklist && !this.tracklist.isDestroyed()) {
			this.tracklist.loadURL(url)
			this.tracklist.show()
			this.tracklist.focus()
			return
		}

		// Kept inside the app rather than thrown at the default browser. This
		// loads nts.live directly, so it gets no preload and stays sandboxed.
		const window = new BrowserWindow({
			width: 460,
			height: 760,
			parent: this.window,
			title: "NTS Tracklist",
			backgroundColor: "#000000",
			autoHideMenuBar: true,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
			},
		})

		window.setMenu(null)
		window.loadURL(url)
		window.on("closed", () => {
			this.tracklist = null
		})

		this.tracklist = window
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

function makeWindow(): BrowserWindow {
	// A normal application window, not the old 360x270 frameless popup that was
	// pinned to a screen corner and vanished the moment it lost focus.
	const window = new BrowserWindow({
		width: 1100,
		height: 720,
		minWidth: 880,
		minHeight: 560,
		show: false,
		// Chromeless. On macOS keep the frame so the traffic lights survive and
		// inset them into our own title bar; elsewhere draw the controls ourselves.
		...(mac
			? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 13, y: 10 } }
			: { frame: false }),
		resizable: true,
		backgroundColor: "#111111",
		title: "NTS",
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
				...h.map((entry) => ({
					label: entry.name,
					click: () => void application.openURL(entry.url),
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
