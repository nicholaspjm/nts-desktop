// defined in app/preload.js
interface Electron {
	once(name: string, callback: (evt: Event, ...args: any[]) => void): void
	addListener(
		name: string,
		callback: (evt: Event, ...args: any[]) => void,
	): () => void
	removeAllListeners(name: string): void
	send(name: string, ...args: any[]): void
	invoke(name: string, ...args: any[]): Promise<any>
}

// The renderer is also served straight from Vite during development, where
// there is no preload script and so no window.electron. Fall back to inert
// no-ops rather than crashing on the first IPC call, so the UI can be worked on
// and inspected in an ordinary browser.
const stub: Electron = {
	once() {},
	addListener() {
		return () => {}
	},
	removeAllListeners() {},
	send() {},
	async invoke() {
		return null
	},
}

// @ts-expect-error: injected by app/preload.js when running inside Electron
const bridge = window.electron as Electron | undefined

export const isElectron = Boolean(bridge)

export const electron = bridge ?? stub
