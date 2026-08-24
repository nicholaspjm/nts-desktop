/**
 * A seek the user asked for.
 *
 * Deliberately not the same value as the playback position. Those were one
 * piece of state, written both by the scrub bar and by the players reporting
 * where they had got to, and the players seeked whenever it changed. So a
 * progress report was indistinguishable from a request to move, and a player
 * fed its own position back to itself as a seek: dragging to 40:00 landed at
 * 1:35, because a progress event still in flight arrived after the seek and
 * dragged it back.
 *
 * `id` is what makes two requests to the same second count as two, so seeking
 * back to where you already are still works.
 */
export type SeekRequest = {
	to: number
	id: number
}
