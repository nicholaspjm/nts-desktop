import { promises as fs } from "node:fs"
import path from "node:path"
import { app } from "electron"

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
	try {
		const content = await fs.readFile(filename, "utf-8")
		// Merge over defaults so a file written by an older build, which has no
		// outputDevice, doesn't come back with the field missing.
		return { ...defaults, ...JSON.parse(content) }
	} catch (err) {
		return defaults
	}
}

export async function write(preferences: Preferences): Promise<void> {
	const content = JSON.stringify(preferences)
	await fs.writeFile(filename, content)
}

export async function clear(): Promise<void> {
	await fs.unlink(filename)
}
