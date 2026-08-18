const { execFileSync } = require("node:child_process")
const path = require("node:path")

/**
 * Applies an ad-hoc signature to the packaged macOS app.
 *
 * Apple Silicon refuses to run an arm64 binary carrying no signature at all,
 * reporting it to the user as "damaged" and offering to bin it. There is no
 * Apple certificate here, but an ad-hoc signature is enough to satisfy that
 * requirement.
 *
 * electron-builder does not do this reliably on its own: setting mac.identity
 * to null makes it skip signing altogether, which is what produced the damaged
 * error in the first place.
 */
exports.default = async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") {
		return
	}

	const app = path.join(
		context.appOutDir,
		`${context.packager.appInfo.productFilename}.app`,
	)

	console.log(`ad-hoc signing ${app}`)
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], {
		stdio: "inherit",
	})
	// Fails loudly rather than shipping something that cannot launch.
	execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
		stdio: "inherit",
	})
	console.log("ad-hoc signature verified")
}
