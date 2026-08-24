/**
 * Genres and moods as the NTS API returns them.
 *
 * Shared because the search and explore endpoints hand back the same shape, and
 * having each parse its own copy is how the two ended up describing the same
 * show differently.
 */
export type Tag = {
	id: string
	name: string
}

type RawTag = { id?: string; name?: string }

/** Keeps only entries with both halves, since a tag missing either cannot be
 * displayed or filtered on. */
export function tags(raw: RawTag[] | undefined): Tag[] {
	return (raw ?? [])
		.filter((t): t is { id: string; name: string } => Boolean(t.id && t.name))
		.map((t) => ({ id: t.id, name: t.name }))
}
