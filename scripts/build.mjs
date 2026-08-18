// Windows-friendly replacement for the macOS-only Makefile targets:
//   index + preload + client + packages
// Run with: node scripts/build.mjs

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import esbuild from "esbuild"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "dist")

// The repo's .env is git-crypt encrypted, so FIREBASE_CONFIG is unavailable to
// anyone outside the maintainer. Firebase only powers the NTS Supporter live
// tracklist; fall back to an inert config so the rest of the app still boots.
function firebaseConfig() {
	try {
		const env = fs.readFileSync(path.join(root, ".env"), "utf8")
		const match = env.match(/^\s*FIREBASE_CONFIG\s*=\s*(.+)$/m)
		if (match) {
			const raw = match[1].trim().replace(/^['"]|['"]$/g, "")
			return { config: JSON.parse(raw), available: true }
		}
	} catch {}

	console.warn("! FIREBASE_CONFIG unavailable - live tracklists will be disabled")

	// An inert config so the module-level initializeApp/getFirestore calls in
	// app/live-tracks.ts don't throw at import time. The `available` flag stops
	// us actually opening a Firestore subscription, which would otherwise retry
	// PERMISSION_DENIED forever in the background.
	return {
		available: false,
		config: {
			apiKey: "unavailable",
			authDomain: "localhost",
			projectId: "nts-desktop-unavailable",
			appId: "1:0:web:0",
		},
	}
}

fs.mkdirSync(dist, { recursive: true })

const firebase = firebaseConfig()

console.log("Building app js...")
await esbuild.build({
	entryPoints: [path.join(root, "app/main.ts")],
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["electron"],
	loader: { ".png": "file" },
	outfile: path.join(dist, "index.cjs"),
	define: {
		FIREBASE_CONFIG: JSON.stringify(firebase.config),
		FIREBASE_AVAILABLE: JSON.stringify(firebase.available),
	},
})

console.log("Copying preload.js...")
fs.copyFileSync(path.join(root, "app/preload.js"), path.join(dist, "preload.js"))

console.log("Building client...")
fs.rmSync(path.join(dist, "client"), { recursive: true, force: true })
const vite = await import("vite")
await vite.build({ root })

console.log("Writing dist/package.json...")
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
// app.getName() reads this, and it ends up on the window, the menu and the
// userData path.
pkg.productName = "NTS Desktop"
pkg.dependencies = undefined
pkg.devDependencies = undefined
pkg.pnpm = undefined
fs.writeFileSync(path.join(dist, "package.json"), JSON.stringify(pkg, null, 2))

console.log("Done.")
