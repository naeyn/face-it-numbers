# Faceit Numbers

Chrome extension for Faceit lobby veto. It shows two separate things, on purpose: the **raw CS2 map win rates** for both teams on the map rows, and a processed **edge score** per map in the floating panel. Stats come from each player's last ~30 Faceit matches (5v5).

No developer API key. The extension reads the same Faceit data the website already shows, using your logged-in Faceit session.

## Install

The extension is not on the Chrome Web Store, so it is loaded unpacked. Either download a prebuilt release or build it yourself — both end at the same **Load unpacked** step.

### From a release

1. Open the [Releases](../../releases) page and download `face-it-numbers-<version>.zip` from the latest release.
2. Unzip it. You get a single `face-it-numbers` folder — put it somewhere you intend to keep, e.g. `~/extensions/face-it-numbers`. Chrome loads an unpacked extension from that folder every time it starts, so deleting or moving it uninstalls the extension.
3. Open `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `face-it-numbers` folder — the one containing `manifest.json`, not the zip itself.
5. Sign in to [faceit.com](https://www.faceit.com/) in the same Chrome profile.
6. Open a CS2 match room (`faceit.com/.../cs2/room/...`).

To update, download the newer zip and unzip it over the same location, replacing the `face-it-numbers` folder, then click the reload icon on the extension's card in `chrome://extensions`. The folder name carries no version, so the path stays the same and your settings survive the update — Chrome derives an unpacked extension's identity from where it lives.

### From source

```bash
npm install
npm run build
```

Then follow steps 3–6 above, selecting the generated `dist` folder.

For local development, `npm run dev` rebuilds into `dist` as you edit. Reload the extension after the first build, then reload the Faceit tab.

## Usage

When the lobby has players:

- `WR 54% · 47%` chips are injected onto the veto map cards. These are always the **raw** last-30 win rates — nothing is smoothed or reweighted.
- The floating panel shows an **edge score** per map (`+26` / `−13`, never a percentage): the win-rate gap after a sample-size shrink and, once you have 8 finished lobbies, a correction learned from your own results. It sorts, badges and suggests ban/pick off that one number.
- The **?** beside the panel's caption opens a decoder that spells out those steps and the live state of your calibration.
- Use **Swap teams** if your nickname was not detected and the sides are reversed.
- Click a map in the panel for a per-player breakdown — that drill-down is raw win rates again, labelled as such.

## Releasing

Releases are built and published by [`.github/workflows/release.yml`](.github/workflows/release.yml). Pushing a `v*` tag builds the extension, packages `dist` as `face-it-numbers-<version>.zip` (wrapping it in a `face-it-numbers/` folder so it unzips ready to load), and publishes a GitHub release with that zip attached and generated notes:

```bash
git tag v1.1.0
git push origin v1.1.0
```

The tag is the single source of truth for the version: the workflow stamps it into `package.json`, and `manifest.config.ts` reads the version from there, so `manifest.json` matches the release. A prerelease tag such as `v1.1.0-rc.1` is marked as a prerelease and ships as `1.1.0` in the manifest, since Chrome only accepts numeric version parts. The workflow can also be started from the Actions tab via **Run workflow**, which creates the tag if it does not exist.

## Privacy

Requests go only to `www.faceit.com` and `api.faceit.com`. A Faceit session cookie may be used so those requests succeed while you are logged in. Nothing is sent to a third-party server. Full policy: [PRIVACY.md](PRIVACY.md).

Faceit Numbers is an unofficial project and is not affiliated with or endorsed by FACEIT.
