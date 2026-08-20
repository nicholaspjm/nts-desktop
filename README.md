<img src="./logos/logo.png" width="120" height="120" alt="NTS" />

# NTS Desktop

An unofficial desktop player for [NTS Radio](https://www.nts.live/), built for
uninterrupted background listening on Windows and macOS.

Not affiliated with, endorsed by, or supported by NTS. Please do not report bugs
in this app to them.

## Download

Take the file for your machine from the
**[latest release](https://github.com/nicholaspjm/nts-desktop/releases/latest)**:

| File | For |
| --- | --- |
| `NTS-Desktop-Windows.exe` | Windows |
| `NTS-Desktop-Mac-Apple-Silicon.dmg` | Macs with an M1, M2, M3 or M4 chip |
| `NTS-Desktop-Mac-Intel.dmg` | Older Macs with an Intel chip |

Not sure which Mac you have? Click the Apple menu, then **About This Mac**. If
the Chip line says Apple M-anything, take the Apple Silicon one.

### Windows

Run the `.exe`. Windows shows a blue "Windows protected your PC" box because
the app is not code signed: click **More info**, then **Run anyway**. It installs
for your user only and never asks for an administrator password, then appears in
the Start Menu and Windows search as **NTS Desktop**.

### macOS

Open the `.dmg` and drag **NTS Desktop** to Applications, then open it. That is
the whole thing. The app is signed and notarised by Apple, so it launches like
anything else, with no warning and no Terminal.

Versions before 0.7.1 were not notarised and needed a command run against them
first. If you followed those instructions before, you can forget them.

### Building it yourself

Requires [Node](https://nodejs.org/) 20 or newer. `make` is not needed, and a
plain clone needs nothing but git.

```
git clone https://github.com/nicholaspjm/nts-desktop.git
cd nts-desktop
npx pnpm@10 install
npx pnpm@10 start
```

To produce an installer into `bundle/` for the machine you are on:

```
npx pnpm@10 exec electron-builder build --win --publish=never
npx pnpm@10 exec electron-builder build --mac --publish=never
```

Each platform's installer has to be built on that platform. Pushing a `v*.*.*`
tag builds both in CI and attaches them to the release.

### Signing, for whoever maintains this

A build with no credentials is ad-hoc signed, which is enough to launch but
makes macOS warn on first open. To sign and notarise properly, set these as
repository secrets under Settings, Secrets and variables, Actions:

| Secret | What it is | Where it comes from |
| --- | --- | --- |
| `MAC_CERT_P12` | Developer ID Application certificate, base64 | exported from Keychain Access |
| `MAC_CERT_PASSWORD` | the password set when exporting it | chosen at export time |
| `APPLE_API_KEY` | App Store Connect key file, base64 | App Store Connect, Integrations, Keys |
| `APPLE_API_KEY_ID` | that key's ID | shown next to the key |
| `APPLE_API_ISSUER` | the issuer ID | shown above the key list |

All five are optional and the build degrades rather than failing: without the
certificate it signs ad-hoc, and without the key it skips notarisation. A fork
with no secrets set still produces working installers, they just warn on first
launch.

Every release build verifies itself afterwards, reading the signing authority
back off the packaged app and asking Gatekeeper what it makes of the result. A
signed-but-unnotarised app is indistinguishable from a notarised one inside the
build, and only the second kind opens without a warning, so the build says which
it produced rather than leaving it to be discovered on someone's machine.

The certificate expires on 1 February 2027. Builds notarised before then keep
working afterwards, because the timestamp outlives the certificate, but new ones
will need a fresh one.

The Windows build is separate and still unsigned. Silencing SmartScreen needs
its own code-signing certificate, which is a different purchase.

## Origin

This is a fork of **[romeovs/nts-desktop](https://github.com/romeovs/nts-desktop)**
by Romeo Van Snick, MIT licensed. That project is a macOS menubar app, and this
fork began as a Windows port of it.

It has since diverged substantially: the menubar popup became a full window, and
live channels, Infinite Mixtapes, the schedule, archive search and playback,
stream diagnostics and output device selection were added. The original author's
work is the foundation, and the MIT licence and copyright are retained in
[LICENSE](./LICENSE).

## What it does

**Keeps playing.** The NTS streams are plain continuous connections, so when one
drops the audio just stops, often without the browser raising an error. A
watchdog notices by watching playback position rather than waiting for an error,
reconnects with a backoff, and resets the moment audio returns. HLS is the
default because it buffers around a minute against the direct stream's two
seconds, so a stutter has to last a long time to be audible. Both are the same
256kbps audio. Playback continues at full quality while minimised.

**Listening**

- Both live channels, with artwork, times, location, description and tags
- All Infinite Mixtapes, with AAC where NTS publishes it
- The full 18 slot schedule for both channels
- Archive search and playback, including pasting an `nts.live` show link
- Show detail before you play, listening history, and Open on NTS
- Media keys, a sleep timer that fades out, and output device selection
- Chromecast, from its own button in the bottom bar. The device fetches the
  stream itself rather than being fed audio from here, so nothing is re-encoded
  and playback carries on once the laptop is shut. Volume and mute are sent to
  the device, and the app keeps watching it and reloads the stream if it stalls.
  Archive shows cannot be cast: they play through embedded players rather than
  the stream, so there is nothing to hand over

  Devices are looked for only when that button is opened, never at launch. The
  first time you open it, Windows will ask whether to allow the app through the
  firewall, because finding devices means listening on the local network. Say
  yes or no devices will appear

**Stream diagnostics**

- Bitrate, codec, sample rate and channel mode decoded from the audio itself
  rather than taken on trust from the server's headers, with both shown side by
  side so a misreporting server is visible
- A warning when the stream's sample rate does not match your output device
- A buffer graph marking every stall and reconnect

**The window**

- No OS title bar or menu strip, a full screen now playing view, and station
  switching from the bottom bar
- Update checks, a crash log, and problem reporting
- Notarised on macOS, so it opens with no warning. Installs per user on Windows,
  with no administrator password

Live tracklists are an NTS Supporter feature and stay behind their sign in. There
is no equaliser: analysing audio in the browser requires the stream to be
requested in a mode the redirect does not permit, which stops playback outright.

## How this app gets its data

NTS publishes no public API documentation. Everything here uses the same
endpoints the nts.live website calls from an ordinary browser session, found by
watching the site's own network requests. That makes it undocumented rather than
private, and it can change without notice.

Every request is one the website itself makes, using no authentication. Audio is
streamed for listening exactly as the site does: nothing is recorded, cached to
disk, re-hosted or downloaded. Titles, descriptions and artwork are shown as NTS
serves them and stay theirs.

| Purpose | Endpoint |
| --- | --- |
| Live now and schedule | `www.nts.live/api/v2/live` |
| Infinite Mixtapes | `www.nts.live/api/v2/mixtapes` |
| Archive search | `www.nts.live/api/v2/search` |
| A single archive show | `www.nts.live/api/v2/shows/…` |
| Audio | `stream-relay-geo.ntslive.net`, `stream-mixtape-geo.ntslive.net`, and the `radiomast.io` CDN they redirect to |

## Licence

MIT, inherited from the upstream project. See [LICENSE](./LICENSE).

### Third party

Playback of the buffered live streams and the AAC mixtapes uses
[hls.js](https://github.com/video-dev/hls.js), Apache-2.0 licensed, which is
bundled into the installers. The remaining dependencies are listed in
`package.json`.
