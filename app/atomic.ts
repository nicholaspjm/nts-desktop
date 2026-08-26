import { promises as fs } from "node:fs"

/**
 * Writes JSON so a reader never sees half of it.
 *
 * fs.writeFile truncates before writing, so a crash or an overlapping write in
 * that gap leaves a partial file. For the small state files this app keeps,
 * that is not a corrupt byte here and there: a preferences or history file that
 * will not parse is read as empty, and the settings or the listening history
 * are gone. Writing beside the target and renaming into place is atomic on the
 * same filesystem, so a reader sees the old file or the new one.
 *
 * The pid is in the temporary name so two copies of the app running at once
 * cannot write over each other's half-finished file.
 */
export async function writeJson(filename: string, data: unknown): Promise<void> {
	const temp = `${filename}.${process.pid}.tmp`
	await fs.writeFile(temp, JSON.stringify(data))
	await fs.rename(temp, filename)
}

/**
 * Runs read-modify-write jobs one at a time.
 *
 * A read followed by a write is two steps, and nothing stops two of them
 * interleaving: both read the same state, both write, and the second undoes the
 * first. The renderer sends state on every input event, so this is routine
 * rather than rare.
 *
 * A failure never rejects the chain, since that would poison every write queued
 * behind it, but it is handed to `onError` rather than disappearing: a write
 * that quietly stopped working is exactly the kind of thing worth knowing about
 * from a crash log afterwards.
 */
export function serialise(
	onError?: (err: unknown) => void,
): (job: () => Promise<void>) => Promise<void> {
	let chain: Promise<void> = Promise.resolve()

	return function (job: () => Promise<void>): Promise<void> {
		chain = chain.then(job, job).catch(function (err) {
			onError?.(err)
		})
		return chain
	}
}
