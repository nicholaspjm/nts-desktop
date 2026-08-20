/**
 * Minimal types for `castv2`, which ships none.
 *
 * Only the surface this app uses is declared. The package is a thin, stable
 * wrapper over the CASTV2 wire protocol and has not changed since 2019, so a
 * hand-written declaration is less risk than it would be for a moving library.
 */
declare module "castv2" {
	import type { EventEmitter } from "node:events"

	export interface CastChannel {
		send(data: unknown): void
		on(
			event: "message",
			handler: (data: Record<string, unknown>, broadcast: boolean) => void,
		): void
		close(): void
	}

	export class Client extends EventEmitter {
		connect(
			options: { host: string; port?: number } | string,
			callback?: () => void,
		): void
		createChannel(
			sourceId: string,
			destinationId: string,
			namespace: string,
			encoding: "JSON" | "BINARY",
		): CastChannel
		close(): void
	}
}
