import { app } from "electron"

import { NTSApplication } from "./application"

let application = null

async function main() {
	// Without these the OS labels the app "Electron": app.getName() drives the
	// userData folder and menu, and Windows uses the AppUserModelId for the name
	// and icon shown on notifications and in the taskbar grouping.
	app.setName("NTS")
	if (process.platform === "win32") {
		app.setAppUserModelId("com.nicholaspjm.nts")
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
