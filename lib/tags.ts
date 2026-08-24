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

// NTS hands these back in two shapes. Search and explore results use
// { id: "jazz-ambientjazz", name: "Ambient Jazz" }, while a single episode uses
// { id: "genres-jazz-ambientjazz", value: "Ambient Jazz" }. Same tag, different
// spelling, so both are normalised here rather than in each caller.
type RawTag = { id?: string; name?: string; value?: string }

/** Strips the kind prefix the episode endpoint adds, so an id from either shape
 * matches the ones the explore filters use. */
function normaliseId(id: string): string {
	return id.replace(/^(genres|moods)-/, "")
}

/** Keeps only entries with both halves, since a tag missing either cannot be
 * displayed or filtered on. */
export function tags(raw: RawTag[] | undefined): Tag[] {
	return (raw ?? [])
		.map((t) => ({ id: t.id ?? "", name: t.name ?? t.value ?? "" }))
		.filter((t) => t.id !== "" && t.name !== "")
		.map((t) => ({ id: normaliseId(t.id), name: t.name }))
}
