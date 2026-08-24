import { app } from "electron"

import { NTSApplication } from "./application"
import * as diagnostics from "./diagnostics"

let application = null

// A crash with nothing written down is a bug report that says "it stopped".
process.on("uncaughtException", (error) => {
	diagnostics.record("uncaught exception", error?.stack ?? String(error))
})
process.on("unhandledRejection", (reason) => {
	diagnostics.record("unhandled rejection", String(reason))
})

async function main() {
	// Without these the OS labels the app "Electron": app.getName() drives the
	// userData folder and menu, and Windows uses the AppUserModelId for the name
	// and icon shown on notifications and in the taskbar grouping.
	app.setName("NTS Desktop")
	if (process.platform === "win32") {
		// Windows caches a taskbar icon against this id, not against the window or
		// the executable. A build running from source is a different executable
		// with Electron's own icon, so letting it claim the installed app's id
		// caches Electron's logo against that identity, and the installed app then
		// shows it too however correct its own icons are. Every icon can be right
		// and the taskbar still wrong.
		//
		// So only a packaged build claims the real id. The cost is that toast
		// notifications from a source build have no registered shortcut to hang
		// off and may not appear, which is a fair trade against corrupting the
		// installed app's identity on the developer's own machine.
		app.setAppUserModelId(
			app.isPackaged
				? "com.nicholaspjm.nts-desktop"
				: "com.nicholaspjm.nts-desktop.source",
		)
	}

	// Upstream only treats a packaged .asar as production, so running the built
	// app directly (`electron dist`) tries to load the Vite dev server and shows
	// a blank window if it isn't up. Serve the built client unless we're
	// explicitly developing.
	const production = __dirname.endsWith(".asar") || process.env.NTS_DEV !== "1"
	console.log(`Starting NTS Desktop... (production=${production})`)

	await app.whenReady()

	application = new NTSApplication(production)
	await application.init()
}

main()
