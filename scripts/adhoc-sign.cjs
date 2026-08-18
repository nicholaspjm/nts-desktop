const { execFileSync } = require("node:child_process")
const path = require("node:path")

/**
 * Applies an ad-hoc signature to the packaged macOS app, but only when there is
 * no real Apple certificate to sign it with.
 *
 * Apple Silicon refuses to run an arm64 binary carrying no signature at all,
 * reporting it to the user as "damaged" and offering to bin it. An ad-hoc
 * signature satisfies that, and is what builds from source get.
 *
 * electron-builder does not do this reliably on its own: setting mac.identity to
 * null makes it skip signing altogether, which is what produced the damaged
 * error in the first place.
 *
 * When a Developer ID certificate IS available this must stand aside. This hook
 * runs before electron-builder signs, and signing here with --deep would leave
 * the nested frameworks carrying a throwaway signature for electron-builder to
 * work around. Worse, --deep is deprecated by Apple and notarisation rejects
 * bundles it has mangled.
 */
function hasRealIdentity() {
	// Set by CI, and by anyone pointing the build at an exported certificate.
	if (process.env.CSC_LINK || process.env.CSC_NAME) {
		return true
	}

	// Otherwise electron-builder discovers a certificate from the keychain, so
	// look where it will look.
	try {
		const identities = execFileSync(
			"security",
			["find-identity", "-v", "-p", "codesigning"],
			{ encoding: "utf8" },
		)
		return identities.includes("Developer ID Application")
	} catch {
		// No keychain, or the tool is missing. Assume there is nothing to find.
		return false
	}
}

exports.default = async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") {
		return
	}

	if (hasRealIdentity()) {
		console.log(
			"Developer ID certificate available, leaving signing to electron-builder",
		)
		return
	}

	const app = path.join(
		context.appOutDir,
		`${context.packager.appInfo.productFilename}.app`,
	)

	console.log(`no certificate available, ad-hoc signing ${app}`)
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
		stdio: "inherit",
	})
	// Fails loudly rather than shipping something that cannot launch.
	execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
		stdio: "inherit",
	})
	console.log("ad-hoc signature verified")
}
