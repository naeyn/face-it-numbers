# Privacy Policy — Faceit Numbers

_Last updated: 2026-08-23_

Faceit Numbers is a browser extension that shows CS2 map play and win rates for
both teams in a Faceit match room. It is unofficial and not affiliated with
FACEIT.

## What the extension accesses

- **Your Faceit session token.** While you are logged in to faceit.com, the
  extension reads the session token from the Faceit page (cookie or local
  storage) so it can request match and player statistics on your behalf — the
  same data the Faceit website itself shows you. The token is used solely as
  the `Authorization` header on requests to Faceit and is never stored
  persistently or sent anywhere other than `faceit.com` / `api.faceit.com`.
- **Match and player statistics.** Match rosters, map veto state, and each
  player's recent match statistics are fetched from Faceit's servers to build
  the overlay.
- **Leetify public statistics.** For the role-pendant feature, the extension
  queries the Leetify public API (`api-public.cs-prod.leetify.com`) with the
  public Steam64 game identifiers of the players in the match room to fetch
  their public career statistics. These identifiers are public gaming ids
  exposed by Faceit, not personal data collected from you. Leetify responses
  are cached only in session storage for up to 15 minutes and are never stored
  persistently, per Leetify's developer guidelines. Career-based badges are
  marked "Data provided by Leetify."

## What the extension stores

All storage is local to your browser (`chrome.storage`):

- Your feature settings (which extras are enabled, team colors, overlay
  position).
- A short-lived (15 minute) in-session cache of fetched player statistics, so
  reopening a lobby does not refetch everything.
- A record of your own finished lobbies' veto outcomes for the optional
  "smart pick" calibration.

Nothing is synced to any server operated by the developer.

## What the extension sends

Network requests go exclusively to `www.faceit.com` and `api.faceit.com`.
There is no analytics, telemetry, advertising, or any third-party service.
No data is sold or shared with anyone.

## Removal

Uninstalling the extension removes all locally stored data. You can also clear
it at any time via the browser's extension storage controls.

## Contact

Questions or concerns: open an issue on this repository.
