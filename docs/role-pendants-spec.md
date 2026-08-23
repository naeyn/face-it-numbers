# Role Pendants — Draft Spec (not implemented)

A second, orthogonal badge family shown next to the existing post-game performance labels
(`gameLabels`). Performance labels say *how you played vs. your own norm* (form axis);
role pendants say *what job you did* (role axis). A player can carry one of each,
side by side.

Status: **Phase 0 complete, Phase 1 implemented and field-verified** on
`feature/role-pendants`. Phases 2a/2b (Leetify) not started. The roster→steam64 path
for Phase 2 is confirmed: Faceit's `/users/v1/users/{id}` exposes
`platforms.steam.id64` / `games.cs2.game_id`.

## Verified compact-key dictionary (Phase 0 result, 2026-08-23)

`/stats/v1/stats/matches/{id}` returns ONLY compact keys — no named keys. No public
mapping exists; this one was derived by cross-referencing 13 live player rows (two
matches) against Leetify named stats for the same match plus arithmetic invariants,
each locked key matching 10/10 players exactly:

| key | meaning | proof |
|---|---|---|
| `i6` / `i7` / `i8` | kills / assists / deaths | matches scoreboard |
| `i9` | **MVPs** | = Leetify `mvps`, 10/10 |
| `i10` | result (0/1) | |
| `i13` | **headshot kills** | = `c4`·kills; = Leetify `total_hs_kills` (NOT triple kills — the time-stats dictionary does not apply) |
| `i14` / `i15` / `i16` | triple / quadro / penta kills | = Leetify `multi3k/4k/5k`, 10/10 |
| `i20` | **total damage** (not ADR) | ADR = `i20`/rounds = `c10` |
| `i21` / `i22` | entry count / entry wins | lobby sum of `i22` = round count (one first-kill per round); sum of `i21` = 2× rounds (both duelists); `c11` = `i22/i21`, `c12` = `i21`/rounds |
| `i23` / `i24` | 1v1 count / wins | `c13` = `i24/i23`, 10/10 |
| `i25` / `i26` | 1v2 count / wins | `c14` = `i26/i25` |
| `i27` / `i28` / `i29` | enemies flashed / flashes thrown / flash successes | `i28` = Leetify `flashbang_thrown` 10/10; `c15`/`c17` per-round forms; `i29 ≤ i27` invariant holds 13/13 |
| `i30` / `i31` / `i33` | utility damage / HE thrown / utility successes | `i31` = Leetify `he_thrown` 10/10; `c18` = `i30/i31`, `c19` = `i30`/rounds, `c20` = `i33/i31`, `c21` = `i31`/rounds |
| `i39` | sniper kills | `c36` = `i39`/rounds, `c22` = `i39`/kills |
| `i40` | double kills | = Leetify `multi2k`, 10/10 |
| `c2` / `c3` / `c4` / `c10` | K/D, K/R, HS%, ADR | arithmetic |
| `i32`, `i34`, `i35`, `i38` | **unknown** | tested against Leetify trade stats — no match |
| `i36`, `i37` | unknown (all zero in samples; suspected knife/zeus) | unproven |

Consequences: pistol/knife/zeus kills have no verified key → **Pistol demon and
Humiliation are dormant** (their stats parse null and the roles never fire) until a
match with visible nonzero values pins `i32`/`i34`/`i35`/`i38`/`i36`/`i37`. Rounds per
player fall back to `round(i20/c10)` when the round header is missing. The `c16` ratio
also remains unidentified.

Naming principle: every badge name is a term casters, coaches, or the game itself already
use (entry, lurker, space taker, closer, one-tap, Humiliation) — or clearly playful
without claiming canon (Pistol demon). No invented jargon, no forced meme-speak. Where a
canon term's real meaning can't be computed honestly, the badge is dropped rather than
mislabeled (see "Not derivable").

---

## Shared design

- New label family `RoleLabel` with its own `FeatureKey` (`roleLabels`, "Role pendants",
  Post game group in `src/lib/settings.ts`). Independent of `gameLabels`.
- Sub-toggle **`banterLabels` ("Banter labels")**, on by default, nested under
  `roleLabels`: gates the negative-tone badges (**Baiter**, **Team flasher**). Turning it
  off removes only those two from the precedence list; everything else is unaffected.
- **One role pendant per player max.** All phases feed one precedence list; when
  later-arriving data (Phase 2a/2b) comes in, assignment re-runs and repaints
  (signature change), filling players who have no role yet — it never replaces an
  already-shown pendant.
- Most roles are **lobby-relative** (best among the 10 players in this match) with an
  **absolute floor** so low-signal games award nothing. Lobby-relative roles are unique
  (ties: no award); absolute roles (Clutcher, Highlight reel, Humiliation) can go to
  several players.
- Rendering hooks into `src/content/player-labels.ts`: a `roleBadgeFor()` sibling of
  `badgeFor()` (`:194-205`), same `.fin-player-label` styling with a new `role` class
  variant, own icon set, tooltip shows the underlying numbers.
- Career pendants (Phase 2a) use a visually distinct sub-style (outlined instead of
  filled) so a lifetime tendency is never mistaken for a this-match achievement.
- **No pendants in the DOM-scrape fallback path** (`labelsFromPage`) — the scoreboard
  scrape has none of these stats; absent beats degraded.
- Tones reuse existing classes: `good` / `bad` / `info`. Negative roles (Baiter,
  Team flasher) are part of the point but get the strictest thresholds.

### Precedence (first match wins; rare/flavorful high, accusatory strict, career last)

1. Humiliation
2. Clutcher
3. Baiter
4. Highlight reel
5. Opener
6. AWPer
7. Trade machine
8. One-tapper
9. Closer
10. Space taker
11. Lurker
12. Utility king
13. Team flasher
14. Pistol demon
15. Flash glue
16. Damage dealer
17. Survivor
18. Support
19. Career entry
20. Career trader
21. Flash support
22. Crosshair placement
23. Spray control
24. Instant reflexes
25. CT-sided / T-sided

---

## Phase 0 — payload verification (prerequisite, ~30 min)

The Phase-1 field names are corroborated by Faceit's CS2 Advanced Stats announcement and
third-party trackers (Faceit Tracker exposes "Entry Rate", "Total Entry Count",
"Utility Damage", "Sniper Kill Rate per Round" etc.), but the exact key spellings in the
`player_stats` object of the match-stats endpoints have **not** been verified against a
live payload (Cloudflare blocks tokenless curl; the extension's in-browser session works).

- In `parseRounds` (`src/lib/match-stats.ts:76`), temporarily `console.debug` the raw key
  set of one `player_stats` object on a finished match.
- Record exact spellings for: entry, utility, flash, sniper, 1v1/1v2, multi-kill, MVP,
  pistol/knife/zeus, headshot, round-count keys, plus any compact `i`-key aliases.
- Also verify the roster row's steam64 field on `/match/v2/match/{id}`
  (`game_player_id` / `gamePlayerId`) — needed for Leetify player matching.
- Update the alias tables; delete the debug line.

Candidate names to look for: `Entry Count`, `Entry Wins`, `Entry Rate`,
`Match Entry Rate`, `Match Entry Success Rate`, `First Kills`, `Utility Damage`,
`Utility Damage per Round`, `Utility Count`, `Utility Successes`, `Enemies Flashed`,
`Flash Successes`, `Flash Count`, `Flashes per Round`, `Sniper Kills`,
`Sniper Kill Rate per Round`, `1v1Count`, `1v1Wins`, `1v2Count`, `1v2Wins`,
`Match 1v1 Wins`, `Match 1v2 Wins`, `Clutch Kills`, `Triple Kills`, `Quadro Kills`,
`Penta Kills`, `MVPs`, `Pistol Kills`, `Knife Kills`, `Zeus Kills`, `Headshots`,
`Headshots %`.

---

## Phase 1 — Faceit extended stats (zero extra requests)

### Data

Widen `parseRounds` to carry extra per-player fields in a parallel `RoleStats` record
keyed by playerId (keeps `ThisGameLine` untouched for the existing label code):

```ts
type RoleStats = {
  rounds: number;          // round_stats or i18; missing -> skip rate-based roles
  entryCount: number;      // "Entry Count"
  entryWins: number;       // "Entry Wins"
  sniperKills: number;     // "Sniper Kills"
  utilityDamage: number;   // "Utility Damage"
  enemiesFlashed: number;  // "Enemies Flashed"
  flashSuccesses: number;  // "Flash Successes"
  oneV1Wins: number; oneV1Count: number;
  oneV2Wins: number; oneV2Count: number;
  tripleKills: number; quadroKills: number; pentaKills: number;
  mvps: number;
  pistolKills: number; knifeKills: number; zeusKills: number;
  headshotPct: number;
};
```

Same alias-lookup pattern as the existing `num(...)` helpers; every field defaults to
`null` when absent, and a role formula that touches a `null` field simply never fires
(forward-compatible with Faceit dropping/renaming keys).

Source is the already-cached `thisGameCache` response — **no new HTTP requests**.

### Roles & draft formulas

`perRound(x) = x / rounds`. "Lobby-max/min" = strict best among the 10 players (ties: no
award). All thresholds are draft values to calibrate in Phase 0/beta.

| Role | Tone | Formula (draft) | Provenance |
|---|---|---|---|
| **Clutcher** | good | `oneV1Wins + oneV2Wins >= 3`, or `>= 2` incl. at least one 1v2 | canon |
| **Opener** | good | lobby-max `perRound(entryCount)` AND `>= 0.22` AND `entryWins/entryCount >= 0.45` | canon (entry) |
| **Space taker** | good | lobby-max `perRound(entryCount)` AND `>= 0.22` but entry success `< 0.45` (fell through Opener) | modern analyst term |
| **AWPer** | info | lobby-max `sniperKills` AND `>= 7` AND `sniperKills/kills >= 0.35` | canon |
| **Utility king** | good | lobby-max `perRound(utilityDamage)` AND `utilityDamage >= 120` AND `perRound(enemiesFlashed) >= 0.5` | common usage |
| **One-tapper** | good | lobby-max `headshotPct` AND `>= 65` AND kills `>= 15` | canon (one-tap) |
| **Closer** | good | lobby-max `mvps` AND `>= 6` AND `>= 1` clutch won AND not lobby-max entry attempts | opener/closer axis |
| **Highlight reel** | good | `pentaKills >= 1` OR `quadroKills >= 2` OR `tripleKills >= 4` | descriptive |
| **Damage dealer** | info | lobby-max ADR but not lobby-max kills | caster phrasing |
| **Pistol demon** | info | `pistolKills/kills >= 0.3` AND `pistolKills >= 7` (floor above what two pistol rounds alone produce) | playful, non-canon by design |
| **Humiliation** | info | `knifeKills + zeusKills >= 2`, or `>= 1` knife kill in a won match | CS 1.6 announcer award |
| **Support** | info | lobby-max `assists/max(kills,1)` AND `assists >= 10` AND `kd < 1.15` | canon |

Tooltip detail strings mirror the existing `detail` format, e.g.
`Opener: 0.31 entry attempts/round (14 att, 7 won) · most in lobby`.

### Failure modes

- Any required field missing from the payload → that role silently never fires.
- `rounds` missing → skip rate-based roles, keep count-based ones.
- Fallback DOM-scrape path → no role pendants at all.

---

## Phase 2a — Leetify career roles from lifetime profiles (instant, no demo wait)

`GET https://api-public.cs-prod.leetify.com/v3/profile?steam64_id={id}` serves
**already-aggregated lifetime stats** — no demo-ingest delay, available the moment we
know the roster. Two consequences:

- Post-game, career pendants can render on the *first* poll tick, before the this-match
  Leetify data (Phase 2b) exists.
- The same data is usable **pre-game** — an optional later step could surface career tags
  in the team brief next to Merchant/Fragger during veto.

### Cost & coverage

- Up to 10 requests per match (one per player). Unauthenticated bursts 429 after ~5 rapid
  calls → throttle to ~1 req/s (whole roster in ~10 s, background, non-blocking), or add
  an optional API key. Session-cache per player (`finLeetifyProfile:{steam64}`, 15 min
  TTL, session storage only per ToS) — recurring teammates are cache hits.
- `404` for players Leetify doesn't track (roughly half a random lobby) and
  `privacy_mode` can hide data → career pendants are best-effort per player;
  negative-cache 404s for the session.

### Roles & draft formulas (lifetime fields, exact names from `/v3/profile`)

| Role | Tone | Formula (draft) |
|---|---|---|
| **Career entry** | info | `rating.opening` lobby-max AND side-matched `*_opening_duel_success_percentage >= 50` |
| **Career trader** | good | `trade_kills_success_percentage >= 60` AND `trade_kill_opportunities_per_round` lobby-high |
| **Flash support** | info | `flashbang_hit_foe_per_flashbang` lobby-max AND `flashbang_leading_to_kill` above floor |
| **Crosshair placement** | good | lobby-min `preaim` (degrees off-target — lower is better) below threshold |
| **Spray control** | good | lobby-max `spray_accuracy` above threshold |
| **Instant reflexes** | info | lobby-min `reaction_time_ms` AND `<= ~450` (calibrate on real values) |
| **CT-sided / T-sided** | info | career `rating.ct_leetify` vs `rating.t_leetify` gap above a margin |

Notes:
- Lifetime stats expose trade *success* rates but no `trade_kill_attempts_percentage` —
  **career Baiter is not cleanly derivable**; accusatory trade roles stay in Phase 2b.
- Verify opening-stat semantics (`*_opening_aggression_success_rate` vs
  `*_opening_duel_success_percentage`) against live values before locking formulas.

---

## Phase 2b — Leetify this-match trade/flash roles (1 request per match, best-effort)

### API

- `GET https://api-public.cs-prod.leetify.com/v2/matches/faceit/{faceitMatchRoomId}` —
  per-match stats for **all 10 players** (Leetify and non-Leetify users alike) when
  Leetify tracked the match.
- No auth needed (CORS `*` confirmed from extension origin). We make ≤ 3 calls per
  finished match, so unauthenticated limits are fine. Optional later: API-key setting.
- **Manifest**: add `https://api-public.cs-prod.leetify.com/*` to `host_permissions`
  (`manifest.config.ts:21-24`) — triggers a permission re-prompt on update.

### Fetch strategy

New module `src/lib/leetify.ts`:

- Trigger only when `isMatchFinished()` (same gate as label computation). Non-blocking,
  same spirit as the 900 ms captain-drops race — Faceit-only pendants render
  immediately; Leetify roles top up on a later poll tick.
- This endpoint waits on Leetify's demo ingest. Retry schedule per match: attempt on the
  post-game poll tick, then no sooner than +2 min, then +10 min, **max 3 attempts**,
  then cache "absent" for the session.
- `404` = match not tracked → negative-cache, stop. `429` → one retry with backoff.
- **Session cache only** (in-memory + `chrome.storage.session`, 15 min TTL). Leetify's
  developer guidelines forbid persistent storage of API data — **never** write
  Leetify-derived numbers into `chrome.storage.local` (incl. any future baseline
  accumulation, which must stay Faceit-only).

### Player matching

Leetify keys players by steam64:

1. Roster `game_player_id` from `/match/v2/match/{id}` (verified in Phase 0), matched
   against `stats[].steam64_id`.
2. Fallback: case-insensitive nickname match; on ambiguity, skip the player rather
   than guess.

### Roles & draft formulas (exact names from `MatchDetailsResponse.stats[]`)

| Role | Tone | Formula (draft) |
|---|---|---|
| **Baiter** | bad | lobby-min `trade_kill_attempts_percentage` AND `<= 25` AND `trade_kill_opportunities >= 8` AND `rounds_survived_percentage >= 55` — all guards required; most accusatory badge, tune strict |
| **Trade machine** | good | lobby-max `trade_kills_succeed` AND `>= 4` AND `trade_kills_success_percentage >= 50` |
| **Team flasher** | bad | `flashbang_hit_friend >= 5` AND `flashbang_hit_friend > flashbang_hit_foe` |
| **Flash glue** | good | `flash_assist >= 3` OR lobby-max `flashbang_leading_to_kill` with `>= 3` |
| **Lurker** | info | lobby-min `trade_kill_opportunities_per_round` (rarely near dying teammates = plays apart) AND `leetify_rating >= 0` AND low Phase-1 entry attempts |
| **Survivor** | info | lobby-max `rounds_survived_percentage` AND `>= 55` AND trade-attempt % above the Baiter bar |

The Lurker/Baiter distinction falls out of the data: a **lurker** has few trade
*opportunities* (not near teammates when they die — playing apart is the job); a
**baiter** has plenty of opportunities and doesn't *attempt* them. Baiter sits higher in
precedence, so the accusation wins when both could fire. Survivor requires healthy trade
attempts, so it reads "smart saves," not "hides."

Considered and dropped for v1: per-match side-split rating gap (noisy in one match —
career version lives in Phase 2a), `utility_on_death_avg` hoarder badge (unit/threshold
unclear — revisit with real values).

### Attribution & ToS (from Leetify developer guidelines)

- Tooltip footer on every Leetify-derived pendant: "Data provided by Leetify" + a
  "View on Leetify" link (`https://leetify.com/app/match-details/{leetifyMatchId}`),
  styled with their pink `#F84982`.
- Raw Leetify stat names quoted in the tooltip (e.g. "trade kill attempts: 18%") so our
  labels are clearly *our* interpretation of *their* named stats — we never rename or
  recompute a Leetify metric (we don't touch `leetify_rating` at all).
- No persistent storage (covered above). No implied endorsement.

---

## Not derivable — deliberately omitted

**IGL, Rotator, Anchor, Ninja defuse, Exit fragger, Dry peeker, Eco Cobra** (canon 1.6
meaning: a rifler farming kills against eco'd opponents — needs victim economy/loadout
data; the tempting "high kills, low damage-per-kill" proxy is confounded with one-tap
headshotters). These need positional, economy, or round-timeline data that neither
Faceit aggregates nor Leetify's public API expose. Better to omit than to ship a badge
whose formula doesn't mean what the name promises.

---

## Request-budget impact

| | today | after P1 | after P2a | after P2b |
|---|---|---|---|---|
| finished-match refresh | 1 match + 10 player-stats + ≤15 stat probes (+captain drops) | unchanged | + ≤10 throttled profile calls (session-cached per player) | + ≤3 match-details attempts total |

## Resolved decisions

1. Negative badges (Baiter, Team flasher) ship **on by default** behind the
   **"Banter labels"** sub-toggle (see Shared design).
2. **One pendant per player, no exceptions** — precedence decides, absolute roles
   included.

## Threshold calibration

Target award rates: pendants on roughly 3–6 of 10 players; Baiter/Team flasher well
under 1 per match on average.

Can aggregated Leetify data drive calibration? Checked (2026-08-23):

- **The public API has no aggregate/benchmark endpoints** — verified against the swagger
  spec; it is exactly `/v3/profile`, `/v3/profile/matches`, `/v2/matches/*`, and
  `/api-key/validate`. Leetify's in-app rank benchmarks come from private APIs (out of
  bounds per their guidelines), and the "Data Library" is editorial articles, not a
  machine-readable dataset.
- **Their published benchmark methodology is still usable as a yardstick**: tiers are
  percentile bands over the playerbase — Poor = bottom 10%, Subpar = 10–30%,
  Average = 30–70%, Good = 70–90%, Great = top 10% — with mechanics stats
  (reaction time / time-to-damage, preaim, spotted accuracy) being rank-dependent and
  the rating-style stats rank-independent. Career-badge thresholds should aim at their
  "Great" band (top 10%) so a pendant means something.

Calibration plan:

1. **Dev-time sampling via the public API** (this is the practical version of
   "aggregated Leetify data"): script a one-off crawl of ~100–300
   `/v2/matches/faceit/{id}` payloads across a spread of elos (seed match ids from our
   own recent lobbies), compute per-stat distributions (trade attempt %, survival %,
   trade opportunities/round, flash counts, preaim, reaction time), and derive fixed
   thresholds at the tier boundaries above (negative badges at the bottom ~10%,
   "Great"-style badges at the top ~10%). Hardcode the resulting constants. Deriving our
   own thresholds is our metric, not a recomputed Leetify metric, and the sample is
   analyzed and deleted — no persistent storage of API data ships in the extension.
2. **Faceit-side badges** calibrate the same way from Phase-0 payload collection
   (Faceit data has no storage restriction, so samples can accumulate in
   `chrome.storage.local` during beta if useful).
3. **Lobby-relative guards stay regardless** — they self-calibrate per match and protect
   against drift if the population shifts; fixed floors only stop low-signal awards.
4. Re-check award rates after a week of real usage; adjust floors, not the
   lobby-relative logic.

## Sources

- Leetify Public CS API — Swagger: <https://api-public-docs.cs-prod.leetify.com/> ·
  Developer guidelines: <https://leetify.com/blog/leetify-api-developer-guidelines/> ·
  Benchmark methodology: <https://leetify.com/blog/cs2-benchmarks/> ·
  Stats glossary: <https://leetify.com/blog/leetify-stats-glossary/>
- Faceit CS2 Advanced Stats:
  <https://support.faceit.com/hc/en-us/articles/19309126922140-FACEIT-CS2-Advanced-Stats>
- Faceit developer docs: <https://docs.faceit.com/docs/data-api/data/>
- Role/terminology canon: <https://liquipedia.net/counterstrike/Definitions> ·
  <https://csdb.gg/blog/insights/player-roles-explained/> ·
  <https://refrag.gg/blog/cs2-team-roles-explained/> ·
  <https://dotesports.com/counter-strike/news/csgo-slang-guide-dictionary> ·
  <https://www.urbandictionary.com/define.php?term=Eco+Cobra> (Eco Cobra provenance)
- Field corroboration: <https://faceittracker.net/>
