import { promises as fs } from "node:fs"
import path from "node:path"
import { app } from "electron"

import { writeJson } from "./atomic"
import * as diagnostics from "./diagnostics"

export type Preferences = {
	volume: number
	// Chosen audio output. Empty means the system default.
	outputDevice: string
	// Show aliases the user follows, notified when they start.
	following: string[]
	// Preferred mixtape delivery: the direct MP3, or AAC over HLS.
	mixtapeFormat: "mp3" | "aac"
	// How live channels are fetched. "hls" buffers tens of seconds and rides out
	// network trouble; "direct" is the raw stream, roughly two seconds behind
	// live but with almost no cushion.
	liveDelivery: "hls" | "direct"
}

const defaults: Preferences = {
	volume: 0.8,
	outputDevice: "",
	following: [],
	mixtapeFormat: "mp3",
	liveDelivery: "hls",
}

const filename = path.join(app.getPath("userData"), "preferences.json")

export async function read(): Promise<Preferences> {
	let content: string
	try {
		content = await fs.readFile(filename, "utf-8")
	} catch (err) {
		// No file yet, which is every first run. Not worth reporting.
		return defaults
	}

	try {
		// Merge over defaults so a file written by an older build, which has no
		// outputDevice, doesn't come back with the field missing.
		return { ...defaults, ...JSON.parse(content) }
	} catch (err) {
		// A file that exists but will not parse is a different matter: every
		// setting has just been lost, and this used to happen silently. It should
		// no longer be reachable now that writing is atomic, so if it shows up in
		// a crash log something else is wrong.
		diagnostics.record(
			"preferences unreadable",
			`${content.length} bytes, falling back to defaults`,
		)
		return defaults
	}
}

export async function write(preferences: Preferences): Promise<void> {
	await writeJson(filename, preferences)
}

export async function clear(): Promise<void> {
	await fs.unlink(filename)
}
