import EventEmitter from "node:events"
import path from "node:path"
import bplist from "bplist-parser"
import {
	BrowserWindow,
	type IpcMainEvent,
	Menu,
	type NativeImage,
	Notification,
	Tray,
	app,
	dialog,
	globalShortcut,
	ipcMain,
	nativeImage,
	screen,
	shell,
} from "electron"
import serve from "electron-serve"

import * as credentials from "./credentials"
import * as history from "./history"
import { NTSLiveTracks } from "./live-tracks"
import * as preferences from "./preferences"
import { show } from "./show"

import menubarOne from "../logos/menu-one.png"
import menubarTwo from "../logos/menu-two.png"
import menubar from "../logos/menu.png"

const loadURL = serve({ directory: "client" })

export class NTSApplication {
	window: BrowserWindow
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

		// @ts-expect-error: only supported on macOS
		app.on("open-file", (_evt: IpcMainEvent, filename: string) =>
			this.openFile(filename),
		)
		app.on("will-quit", () => globalShortcut.unregisterAll())
		app.on("activate", () => this.open())

		globalShortcut.register("Control+N", () => this.toggle())

		// app.dock only exists on macOS
		setTimeout(() => app.dock?.hide(), 1500)
		await this.liveTracks.init()
		await this.loadClient()
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

	handleBlur() {
		if (!this.window.webContents.isDevToolsOpened()) {
			this.close()
		}
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

		const trayPos = this.tray.getBounds()
		const windowPos = this.window.getBounds()

		let x = Math.round(trayPos.x + trayPos.width / 2 - windowPos.width / 2)
		let y: number

		if (process.platform === "darwin") {
			y = Math.round(trayPos.y + trayPos.height) + 8
		} else {
			// Tray.getBounds() is unreliable on Windows, and returns junk when the
			// icon is tucked into the overflow flyout rather than sitting on the
			// taskbar itself. So don't anchor to it blindly. Use the work area of
			// whichever display the cursor is on: that's the display the user just
			// clicked the tray or pressed the shortcut on.
			const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
			const { workArea: area, bounds } = display

			// A work area inset from the top means the taskbar is up there.
			const taskbarOnTop = area.y > bounds.y
			y = taskbarOnTop
				? area.y + 8
				: area.y + area.height - windowPos.height - 8

			// Only centre on the tray icon if its bounds look believable.
			const trayIsSane =
				trayPos.width > 0 &&
				trayPos.x >= area.x &&
				trayPos.x <= area.x + area.width
			if (!trayIsSane) {
				x = area.x + area.width - windowPos.width - 8
			}

			x = Math.min(
				Math.max(x, area.x + 8),
				area.x + area.width - windowPos.width - 8,
			)
			y = Math.min(
				Math.max(y, area.y + 8),
				area.y + area.height - windowPos.height - 8,
			)
		}

		this.window.setPosition(x, y, false)
		this.window.show()
		this.window.focus()
		this.liveTracks.subscribe()
		this.liveTracks.sync()

		setTimeout(() => this.window.once("blur", () => this.handleBlur()), 300)
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
		shell.openExternal(`https://www.nts.live/live-tracklist/${channel}`)
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

function makeWindow(): BrowserWindow {
	// Initialise window
	const window = new BrowserWindow({
		width: 360,
		height: 270,
		show: false,
		frame: false,
		resizable: false,
		alwaysOnTop: true,
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

	window.setAlwaysOnTop(true, "floating")
	window.setVisibleOnAllWorkspaces(true)
	window.fullScreenable = false

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
