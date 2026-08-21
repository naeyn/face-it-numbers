# Faceit Numbers

Chrome extension that shows **CS2 map play and win rates** for your team and the enemy team during Faceit lobby veto. Stats come from each player's last ~30 Faceit matches (5v5).

No developer API key. The extension reads the same Faceit data the website already shows, using your logged-in Faceit session.

## Setup

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `dist` folder.
2. Sign in to [faceit.com](https://www.faceit.com/) in Chrome.
3. Open a CS2 match room (`faceit.com/.../cs2/room/...`).

For local development, `npm run dev` rebuilds into `dist` as you edit. Reload the extension after the first build, then reload the Faceit tab.

## Usage

When the lobby has players:

- A floating panel compares team win rates per map (grouped bars) with play counts and a you-minus-them delta.
- Compact `You … | Them …` chips are injected onto the veto map cards when that UI is visible.
- Use **Swap teams** if your nickname was not detected and the sides are reversed.
- Click a map in the chart for a per-player breakdown.

## Privacy

Requests go only to `www.faceit.com` and `api.faceit.com`. A Faceit session cookie may be used so those requests succeed while you are logged in. Nothing is sent to a third-party server.
