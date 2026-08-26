import { type IpcMainInvokeEvent, type WebContents, ipcMain } from "electron"
import { type FirebaseOptions, initializeApp } from "firebase/app"
import {
	type UserCredential,
	getAuth,
	signInWithEmailAndPassword,
} from "firebase/auth"
import {
	type DocumentData,
	type QuerySnapshot,
	collection,
	getFirestore,
	limit,
	onSnapshot,
	orderBy,
	query,
	where,
} from "firebase/firestore"

import { type Stream, pathnameToStream, streamToPathname } from "~/lib/stream"

import * as credentials from "./credentials"

const LIMIT = 15

// @ts-expect-error: injected at build time
const config: FirebaseOptions = FIREBASE_CONFIG

// False when built without the maintainer's git-crypt encrypted .env. Firebase
// only powers the NTS Supporter live tracklist, so we still boot without it,
// but we must not open a subscription: Firestore would retry the resulting
// PERMISSION_DENIED indefinitely in the background.
// @ts-expect-error: injected at build time
const available: boolean = FIREBASE_AVAILABLE

const app = initializeApp(config)
const auth = getAuth(app)
const store = getFirestore(app)

export type LiveTrack = {
	title: string
	stream: Stream | null
	artists: string[]
	startTime: Date
}

type Handler = (err: Error | null, res: LiveTrack[] | null) => void

async function liveTracks(stream: 1 | 2, fn: Handler): Promise<() => void> {
	const qry = query(
		collection(store, "live_tracks"),
		where("stream_pathname", "==", streamToPathname(stream)),
		orderBy("start_time", "desc"),
		limit(LIMIT),
	)

	function handleSnapshot(snapshot: QuerySnapshot<DocumentData, DocumentData>) {
		const res: LiveTrack[] = []
		// biome-ignore lint/complexity/noForEach: we can't use for of here
		snapshot.forEach(function (doc) {
			const data = doc.data()
			res.push({
				title: data.song_title,
				artists: data.artist_names,
				stream: pathnameToStream(data.stream_pathname),
				startTime: data.start_time.toDate(),
			})
		})
		fn(null, res)
	}

	function handleError(err: Error) {
		fn(err, null)
	}

	return onSnapshot(qry, handleSnapshot, handleError)
}

export class NTSLiveTracks {
	webContents: WebContents

	promises: { [creds: string]: Promise<UserCredential> } = {}
	unsubscribe: null | (() => void)
	// Bumped by every subscribe and every stop. Setting up a subscription takes
	// two awaits, and whatever happens during them decides whether the result is
	// still wanted.
	private generation = 0
	previous: {
		stream1: LiveTrack[]
		stream2: LiveTrack[]
	}

	creds: any | null

	constructor(webContents: WebContents) {
		this.webContents = webContents
		this.unsubscribe = null
		this.previous = {
			stream1: [],
			stream2: [],
		}

		ipcMain.handle("login-credentials", this._handleLogin.bind(this))
	}

	async init() {
		if (!available) {
			return
		}

		this.creds = await credentials.read()
		if (!this.creds) {
			return
		}

		await this._auth()
	}

	async logout() {
		this.unsubscribe?.()
		this.creds = null
		await credentials.clear()
	}

	/**
	 * Subscribes to both channels' live tracklists.
	 *
	 * Called on every window open, which is why the bookkeeping matters. It used
	 * to assign over `this.unsubscribe` without calling what was already there,
	 * so each open added two more Firestore listeners and threw away the only
	 * handle that could have stopped the previous pair. They kept firing, kept
	 * writing `previous`, and which of the duplicates won was down to callback
	 * order.
	 */
	async subscribe() {
		if (!available) {
			return
		}

		// Whatever is already running is replaced rather than abandoned.
		this.stop()
		const generation = this.generation

		const strm1 = await liveTracks(1, (err, res) => {
			if (err) {
				console.warn(err)
				return
			}
			if (!res) {
				return
			}

			this.webContents.send("live-tracks-1", res)
			this.previous.stream1 = res
		})

		const strm2 = await liveTracks(2, (err, res) => {
			if (err) {
				console.warn(err)
				return
			}
			if (!res) {
				return
			}

			this.previous.stream2 = res
			this.webContents.send("live-tracks-2", res)
		})

		// A stop() or a newer subscribe() landed while those two awaits were out,
		// so these belong to nobody. Closing the window used to leave them running
		// because the assignment below arrived after the close had already run.
		if (generation !== this.generation) {
			strm1()
			strm2()
			return
		}

		this.unsubscribe = () => {
			this.unsubscribe = null
			strm1()
			strm2()
		}
	}

	/**
	 * Ends any subscription, including one still being set up.
	 *
	 * The generation bump is the half that covers the in-flight case: there is no
	 * handle to call yet, so the only way to stop it is to make it discard itself
	 * when it finishes.
	 */
	stop() {
		this.generation += 1
		this.unsubscribe?.()
	}

	async sync() {
		this.webContents.send("live-tracks-1", this.previous.stream1)
		this.webContents.send("live-tracks-2", this.previous.stream2)
	}

	async _auth() {
		await this._login(this.creds.email, this.creds.password)
	}

	async _login(email: string, password: string) {
		const key = `${email}:${password}`
		if (!this.promises[key]) {
			this.promises[key] = signInWithEmailAndPassword(auth, email, password)
		}

		return this.promises[key]
	}

	async _handleLogin(
		_evt: IpcMainInvokeEvent,
		data: { email: string; password: string },
	) {
		if (!available) {
			throw new Error(
				"Live tracklists are unavailable in this build: it was compiled without FIREBASE_CONFIG.",
			)
		}

		const { email, password } = data

		try {
			await this._login(email, password)
			await credentials.write({ email, password })
			this.subscribe()
			return true
		} catch (err) {
			if (err instanceof Error) {
				throw err
			}
			throw new Error("could not log in")
		}
	}
}
