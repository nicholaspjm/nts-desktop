const path = require("node:path")

/**
 * Sends the packaged macOS app to Apple to be notarised, then staples the
 * result to the bundle.
 *
 * Notarisation is what stops macOS telling the user it "could not verify NTS
 * Desktop is free of malware". It needs a paid Apple developer account, so this
 * skips itself when no credentials are present rather than failing the build.
 * That keeps `pnpm run dist` working for anyone building from source.
 *
 * Stapling matters: it writes the notarisation ticket into the app itself, so a
 * machine that is offline, or behind a firewall that blocks Apple, still opens
 * it without complaint.
 */
exports.default = async function afterSign(context) {
	if (context.electronPlatformName !== "darwin") {
		return
	}

	// CI stores the credentials in a keychain profile, because Apple issues two
	// kinds of App Store Connect key and they authenticate differently: a Team
	// key needs an issuer UUID, an Individual key has none and rejects one. A
	// profile hides that difference from here.
	const profile = process.env.APPLE_KEYCHAIN_PROFILE
	const key = process.env.APPLE_API_KEY
	const keyId = process.env.APPLE_API_KEY_ID
	const issuer = process.env.APPLE_API_ISSUER

	const credentials = profile
		? { keychainProfile: profile }
		: key && keyId && issuer
			? { appleApiKey: key, appleApiKeyId: keyId, appleApiIssuer: issuer }
			: null

	if (!credentials) {
		console.log(
			"no Apple API credentials present, skipping notarisation: macOS will warn on first launch",
		)
		return
	}

	const app = path.join(
		context.appOutDir,
		`${context.packager.appInfo.productFilename}.app`,
	)

	// Required lazily so builds without the credentials, and builds on other
	// platforms, do not need the package resolved at all.
	const { notarize } = require("@electron/notarize")

	// Apple queues these. Minutes is normal, longer is not unheard of.
	console.log(`notarising ${app}, this usually takes a few minutes`)
	await notarize({ appPath: app, ...credentials })
	console.log("notarised and stapled")
}
