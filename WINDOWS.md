# Running NTS Desktop on Windows

Upstream is macOS-only in practice. This fork adds the changes needed to build
and run on Windows.

## Build and run

Requires Node 20+. `make` is *not* needed: `scripts/build.mjs` replaces the
Makefile targets (`index`, `preload`, `client`, `packages`), which were hardcoded
to macOS.

```
npx pnpm@10 install
npx pnpm@10 start
```

To produce an installer in `bundle/`:

```
npx pnpm@10 dist
```

## Finding the app once it's running

It's a tray app with no taskbar entry. Windows 11 hides new tray icons in the
`^` overflow flyout by default; to pin it, go to
`Settings > Personalisation > Taskbar > Other system tray icons` and enable
**NTS Desktop**.

`Ctrl+N` toggles the player window from anywhere, regardless of where the tray
icon has ended up.

## What had to change, and why

- **`app.dock.hide()`** crashed on launch. `app.dock` is macOS-only, so this
  threw a `TypeError` 1.5s after startup on every run.
- **Tray icon was invisible.** `setTemplateImage(true)` is a macOS concept where
  the OS recolours a black silhouette to suit the menubar. Windows does no such
  thing, so the black-on-transparent NTS logo rendered as black on a dark
  taskbar. The icon is now inverted to white on Windows, respecting
  premultiplied alpha so antialiased edges don't blow out.
- **Player window opened off-screen.** The old positioning used
  `y = trayPos.y + trayPos.height * 10` on any non-macOS platform, which places
  the window far below a bottom taskbar. It now anchors to the work area of the
  display Electron reports, detects whether the taskbar is top or bottom, and
  clamps to the work area.
- **No Windows build target.** `electron-builder.yml` only had a `mac:` block.

## Live tracklists are disabled in local builds

The live tracklist feature (an NTS Supporter perk) needs `FIREBASE_CONFIG`,
which upstream stores in a **git-crypt encrypted `.env`**. Nobody outside the
maintainer can decrypt it.

`scripts/build.mjs` detects this and substitutes an inert config so the
module-level `initializeApp`/`getFirestore` calls don't throw at import time. It
also sets `FIREBASE_AVAILABLE=false`, which gates the Firestore subscription.
Without that gate, Firestore retries `PERMISSION_DENIED` indefinitely in the
background for as long as the app is open.

Everything else, live streams included, works without it.

## Known limitations

- **Archive shows are unreachable.** Both entry points are macOS-only: dropping
  a link on the tray icon (`drop-text`/`drop-files` are macOS-only Tray events)
  and the file dialog, which filters for `.webloc`, a macOS bookmark format
  parsed with `bplist-parser`. Live streams are unaffected.
- **Window placement on mixed-DPI multi-monitor setups** is approximate.
  Electron's DIP coordinate space doesn't line up with Win32 physical pixels
  when displays run at different scale factors, so the window may not hug the
  taskbar corner next to the tray icon. It is always clamped on-screen.
