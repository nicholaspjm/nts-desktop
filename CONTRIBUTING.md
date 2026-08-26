# Contributing

Thanks for looking. This is a small project and contributions are welcome,
including ones that are only a bug report.

This app is not affiliated with NTS. **Please do not report anything about it to
them**, and please do not raise issues here about NTS itself: if the schedule is
wrong or a show will not play on nts.live, that is theirs rather than ours.

## Reporting a bug

Open an issue, or use **Report a problem** in the app's menu, which opens the
same form. What helps most:

- Your operating system, and the app version from the menu
- What you were listening to: a live channel, an Infinite Mixtape, or a recorded
  show, since those are three quite different paths through the app
- Whether it happens every time or only sometimes

If the app went blank, froze, or vanished, the crash log is the useful part.
**Show crash log** in the menu opens it, or find `crash.log` in the app's data
folder:

| Platform | Folder |
| --- | --- |
| Windows | `%APPDATA%\NTS Desktop` |
| macOS | `~/Library/Application Support/NTS Desktop` |

It records what the app was doing rather than anything about you. Read it before
attaching it if you would rather be sure of that.

## Getting set up

The README covers this under [Building it
yourself](./README.md#building-it-yourself). In short:

```
npx pnpm@10 install
npx pnpm@10 start
```

Versions are pinned in `.tool-versions`. Nothing needs installing globally, and
a plain clone builds without any credentials.

One thing that will look broken and is not: the live tracklist for the current
show comes from an NTS Supporter account, and the credentials for it are
encrypted in this repo. Without them the app runs normally and simply does not
show that tracklist. Everything else works.

## Before opening a pull request

CI runs three checks, and they are quick to run yourself:

```
npx pnpm@10 run typecheck
npx pnpm@10 run lint
npx pnpm@10 run format:check
```

`npx pnpm@10 run format` fixes the third one. If the linter objects to a
dependency array, prefer fixing the dependency over suppressing the rule: two
bugs in this app's history were a stale closure that the linter had already
pointed at.

There is no test suite. That is not an invitation to skip verifying things, it
means verifying happens by running the app and watching it do the thing. Say in
the pull request what you actually observed, and if you measured something, give
the number.

## How the code here is written

Match what is around you rather than this list, but the recurring habits are:

**Comments say why, not what.** The code already says what. A comment earns its
place by recording something the next person cannot see: what was tried before,
what the API actually returns, why an obvious approach does not work.

**Claims get checked.** Several things in this codebase look wrong until you
know the measurement behind them, so the measurement is written down next to
them. If you are asserting that something is faster, or that an endpoint filters
what it claims to, include how you know. An undocumented API that silently
ignores a parameter it does not recognise will happily look like it is working.

**Guess less about the platform.** Windows and macOS disagree about enough here
that "it works on mine" is weak evidence. Say which you tested on.

## Being fair to NTS

This app reads undocumented endpoints that NTS have not promised anyone. That is
a privilege rather than a right, and two rules follow from it.

**Do not make the app expensive for them.** Requests are made when someone
actually opens the thing that needs them, not on a timer and not at launch for a
screen most sessions never visit. Anything that polls needs a good reason.

**Do not expose what the site itself withholds.** Track artists and titles are
public and the app shows them. Their timings are a Supporter feature, and even
though the API hands them to anyone who asks, the app does not read them at all.
If you find something else in that category, the same applies: the fact that it
is reachable is not the question.

## Commit messages

A short line saying what changed, in the imperative, then a blank line, then why.
The why is the part worth writing: what was wrong, what it did to someone using
the app, and anything you ruled out on the way. Some of the most useful messages
in this history are the ones explaining why the obvious fix was not the fix.

## Things that are hard to test

If you touch these, say so in the pull request and someone with the hardware can
check:

- **Chromecast.** The protocol work has never been run against a real device.
- **Intel Macs.** Built and signed in CI, but as far as anyone knows nobody has
  launched one.
- **Audio output switching**, which behaves differently for live channels and
  recorded shows, because recorded shows play inside SoundCloud's or Mixcloud's
  own frame.

## Releases

Maintainer only. Bump the version in `package.json`, then push a `v*.*.*` tag:
CI builds both platforms, signs and notarises the macOS build, and attaches the
installers to the release.

## Licence

Contributions are made under the same MIT licence as the rest of the project.
This is a fork of [romeovs/nts-desktop](https://github.com/romeovs/nts-desktop),
and that work stays credited in `LICENSE`.
