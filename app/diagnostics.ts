import { promises as fs } from "node:fs"
import path from "node:path"
import { app } from "electron"

/**
 * Records crashes and fatal errors to a file under userData.
 *
 * Without this, a renderer that dies leaves the app sitting there doing nothing
 * and a report of "it stopped working" with nothing to go on.
 */
const filename = () => path.join(app.getPath("userData"), "crash.log")

const LIMIT = 200_000

export async function record(kind: string, detail: string): Promise<void> {
	const line = `[${new Date().toISOString()}] ${kind}\n${detail}\n\n`
	try {
		// Keep the file from growing without bound over a long-running install.
		let existing = ""
		try {
			existing = await fs.readFile(filename(), "utf-8")
		} catch {}
		const next = (existing + line).slice(-LIMIT)
		await fs.writeFile(filename(), next)
	} catch {
		// Logging must never be the thing that brings the app down.
	}
}

export function logPath(): string {
	return filename()
}

export async function read(): Promise<string> {
	try {
		return await fs.readFile(filename(), "utf-8")
	} catch {
		return ""
	}
}
