<img src="./logos/logo.png" width="120" height="120" alt="NTS" />

# NTS Desktop

An unofficial desktop player for [NTS Radio](https://www.nts.live/), built for
uninterrupted background listening on Windows and macOS.

Not affiliated with, endorsed by, or supported by NTS. Please do not report bugs
in this app to them.

## Download

**[Download for Windows](https://github.com/nicholaspjm/nts-desktop/releases/latest)** - grab the `.exe` from the latest release, run it, done. No developer tools needed.

Windows will probably show a blue "Windows protected your PC" box the first time,
because the app is not code signed. Click **More info**, then **Run anyway**. It
installs for your user only, so it never asks for an administrator password.

Once installed it appears in the Start Menu and Windows search as **NTS Desktop**.

### macOS

**[Download for macOS](https://github.com/nicholaspjm/nts-desktop/releases/latest)** - take the `.dmg` from the latest release. It covers both Apple Silicon and Intel Macs.

The app is unsigned and not notarised, so Gatekeeper will refuse it on first
open. Right click the app and choose **Open**, then confirm. Double clicking
will only offer to move it to the bin, so use right click the first time.

macOS support is newer than the Windows side and less exercised. If something
looks wrong there, please open an issue saying what happened.

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

- Both live channels at once, with artwork, times, location, description, genre
  and mood tags
- All Infinite Mixtapes, with an optional AAC stream where NTS publishes one
- The full 18 slot schedule for both channels
- Archive search and playback, including pasting an `nts.live` show link, with
  the show's tracklist
- A reconnect watchdog, because the streams are plain continuous connections
  that otherwise go quiet and never resume
- Stream diagnostics: bitrate, codec, sample rate and channel mode decoded from
  the audio itself, plus a buffer history graph
- Audio output device selection
- Hardware media keys, a sleep timer that fades out, and a listening history

## How this app gets its data, and the limits it keeps

NTS publishes no public API documentation. Everything here uses the same
endpoints the nts.live website calls from an ordinary browser session, found by
watching the site's own network requests. That makes it undocumented rather than
private, and it can change without notice. These are the rules this app holds
itself to.

### What it reads

| Purpose | Endpoint |
| --- | --- |
| Live now and schedule | `www.nts.live/api/v2/live` |
| Infinite Mixtapes | `www.nts.live/api/v2/mixtapes` |
| Archive search | `www.nts.live/api/v2/search` |
| A single archive show | `www.nts.live/api/v2/shows/…` |
| Audio | `stream-relay-geo.ntslive.net`, `stream-mixtape-geo.ntslive.net`, and the `radiomast.io` CDN they redirect to |

### The limits

**Only what a browser would fetch anyway.** Every request is one the website
itself makes. No endpoint is reached by guessing at internal or admin routes,
and nothing is accessed that a logged out visitor could not already load.

**No authentication, and no working around it.** The app signs into nothing. NTS
gates some features behind an NTS Supporter subscription, most visibly live
tracklists. Those stay gated: the app opens the real NTS page and asks you to
sign in there, rather than trying to reconstruct the data another way. When the
live stream's ICY metadata turned out to carry an empty track title, that was
reported as a gap rather than filled by scraping something else.

**Streams are played, never captured.** Audio is streamed for immediate
listening exactly as the website does. The app does not record, cache to disk,
re-host or redistribute any audio, and does not download archive shows. Archive
playback uses the same Mixcloud and SoundCloud players NTS embeds, so plays are
counted by those services as normal.

**Light on their servers.** Schedule polling is driven by when the current show
actually ends rather than a busy timer. Search is debounced so typing does not
fire a request per keystroke. The stream probe reads roughly 64 KB and then
aborts the connection instead of leaving a second audio stream open. Nothing is
crawled in bulk and no endpoint is polled in a tight loop.

**Their words and pictures stay theirs.** Show titles, descriptions, artwork and
tracklists are displayed as NTS serves them, attributed to NTS, and are not
altered or passed off as this project's own. Artwork is loaded from their CDN
rather than copied into this repository.

**Attribution and identity.** The app is clearly labelled unofficial. The NTS
name and logo identify the service it plays and imply no endorsement. The mark
in `logos/nts.svg` is taken from the NTS site header for that identification
only, and remains NTS's trademark.

### If NTS would rather this did not exist

This is a personal listening client, written because the browser player kept
dropping out. If anyone at NTS objects to any part of it, open an issue and it
will be changed or taken down.

## Licence

MIT, inherited from the upstream project. See [LICENSE](./LICENSE).
