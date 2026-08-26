import { promises as fs } from "node:fs"
import path from "node:path"
import { app } from "electron"

import { serialise, writeJson } from "./atomic"
import * as diagnostics from "./diagnostics"

export type Entry = {
	name: string
	// What was played. "archive" entries carry the show URL so they can be
	// reopened; live and mixtape entries have nothing to link to.
	kind: "channel" | "mixtape" | "archive"
	url?: string
	detail?: string
	// ISO timestamp of when it started playing.
	at: string
}

export type History = Entry[]

// Inherited unbounded: it grew forever, one entry per show ever opened.
const LIMIT = 300

const filename = path.join(app.getPath("userData"), "history.json")

export async function read(): Promise<History> {
	try {
		const content = await fs.readFile(filename, "utf-8")
		const parsed = JSON.parse(content)
		if (!Array.isArray(parsed)) {
			return []
		}
		// Entries written by earlier builds have only name and url.
		return parsed
			.filter((e) => e && typeof e.name === "string")
			.map((e) => ({
				name: e.name,
				kind: e.kind === "mixtape" || e.kind === "channel" ? e.kind : "archive",
				url: typeof e.url === "string" ? e.url : undefined,
				detail: typeof e.detail === "string" ? e.detail : undefined,
				at: typeof e.at === "string" ? e.at : "",
			}))
	} catch (err) {
		return []
	}
}

async function write(history: History): Promise<void> {
	await writeJson(filename, history.slice(0, LIMIT))
}

// Adds run one at a time. Two of them overlapping both read the same list and
// both prepend to it, so the second write drops whatever the first added: a
// listen disappears from history entirely.
const queue = serialise((err) =>
	diagnostics.record("history write failed", String(err)),
)

/** Returns whether anything was written, so callers can skip announcing a no-op. */
export async function add(
	entry: Omit<Entry, "at"> & { at?: string },
): Promise<boolean> {
	// Stamped here rather than inside the queue, so an entry is timed by when it
	// was played rather than by when its turn to be written came up.
	const next: Entry = { ...entry, at: entry.at ?? new Date().toISOString() }

	let added = false
	await queue(async function () {
		const history = await read()

		// Don't record the same thing twice in a row: switching away and back, or
		// a reconnect, should not fill the list with duplicates. Checked inside
		// the queue, against what is actually on disk, so two adds of the same
		// thing cannot both pass the check and both write.
		const [first] = history
		if (first && first.name === next.name && first.kind === next.kind) {
			return
		}

		await write([next, ...history])
		added = true
	})

	return added
}

export async function clear(): Promise<void> {
	try {
		await fs.unlink(filename)
	} catch {
		// Nothing written yet.
	}
}
