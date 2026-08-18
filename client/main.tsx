import { createRoot } from "react-dom/client"

import { App } from "~/client/app"
import { electron, isElectron } from "~/client/electron"
import { type Preferences, PreferencesProvider } from "~/client/lib/preferences"

const defaults: Preferences = {
	volume: 1,
	outputDevice: "",
	following: [],
	mixtapeFormat: "mp3",
}

function render(preferences: Preferences) {
	const root = document.getElementById("root")
	if (!root) {
		return
	}

	createRoot(root).render(
		<PreferencesProvider preferences={preferences}>
			<App />
		</PreferencesProvider>,
	)
}

if (isElectron) {
	// The main process replies to "init" with the stored preferences, and only
	// then is it safe to mount.
	electron.once("preferences", function (_: Event, preferences: Preferences) {
		render(preferences)
	})
	electron.send("init")
} else {
	// Served straight from Vite for UI work, where there is no main process to
	// answer "init". Mount immediately with defaults instead of hanging forever.
	render(defaults)
}
