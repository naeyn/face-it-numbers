import { CACHE_TTL_MS } from "./constants";
import { faceitGet } from "./faceit-api";
import type { RosterPlayer } from "./types";

// Leetify public CS API (https://api-public.cs-prod.leetify.com). Career
// profile stats power the pre-match role pendants. Their developer
// guidelines require attribution and forbid PERSISTENT storage of API data:
// Leetify responses live in memory + chrome.storage.session only. The
// steam64 ids come from Faceit and are immutable, so those may cache in
// chrome.storage.local.

const LEETIFY_BASE = "https://api-public.cs-prod.leetify.com";
const FETCH_GAP_MS = 400; // unauthenticated limiter 429s on tight bursts

export type LeetifyProfile = {
  steam64: string;
  totalMatches: number | null;
  openingRating: number | null;
  ctRating: number | null;
  tRating: number | null;
  openingDuelSuccessCt: number | null;
  openingDuelSuccessT: number | null;
  tradeSuccessPct: number | null;
  tradeOppsPerRound: number | null;
  flashHitFoePerFlash: number | null;
  flashLeadingToKill: number | null;
  preaim: number | null;
  reactionTimeMs: number | null;
  sprayAccuracy: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function num(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function parseProfile(steam64: string, raw: unknown): LeetifyProfile {
  const root = asRecord(raw) ?? {};
  const rating = asRecord(root.rating) ?? {};
  const stats = asRecord(root.stats) ?? {};
  return {
    steam64,
    totalMatches: num(root.total_matches),
    openingRating: num(rating.opening),
    ctRating: num(rating.ct_leetify),
    tRating: num(rating.t_leetify),
    openingDuelSuccessCt: num(stats.ct_opening_duel_success_percentage),
    openingDuelSuccessT: num(stats.t_opening_duel_success_percentage),
    tradeSuccessPct: num(stats.trade_kills_success_percentage),
    tradeOppsPerRound: num(stats.trade_kill_opportunities_per_round),
    flashHitFoePerFlash: num(stats.flashbang_hit_foe_per_flashbang),
    flashLeadingToKill: num(stats.flashbang_leading_to_kill),
    preaim: num(stats.preaim),
    reactionTimeMs: num(stats.reaction_time_ms) ?? num(stats.reaction_time),
    sprayAccuracy: num(stats.spray_accuracy),
  };
}

// ---- steam64 resolution (Faceit data — persistent cache allowed) ----

const steamCache = new Map<string, string | null>();

function steamKey(playerId: string): string {
  return `finSteam64:${playerId}`;
}

async function resolveSteam64(
  player: RosterPlayer,
  token: string | undefined,
): Promise<string | undefined> {
  if (player.steam64) return player.steam64;
  const memo = steamCache.get(player.player_id);
  if (memo !== undefined) return memo ?? undefined;
  try {
    const stored = await chrome.storage.local.get(steamKey(player.player_id));
    const hit = stored[steamKey(player.player_id)];
    if (typeof hit === "string" && hit) {
      steamCache.set(player.player_id, hit);
      return hit;
    }
  } catch {
    // storage unavailable — fall through to the network
  }
  try {
    const raw = await faceitGet(`/users/v1/users/${player.player_id}`, token);
    const root = asRecord(raw) ?? {};
    const platforms = asRecord(root.platforms);
    const steam = asRecord(platforms?.steam);
    const games = asRecord(root.games);
    const cs2 = asRecord(games?.cs2);
    const id64 =
      (typeof steam?.id64 === "string" && steam.id64) ||
      (typeof cs2?.game_id === "string" && cs2.game_id) ||
      undefined;
    steamCache.set(player.player_id, id64 ?? null);
    if (id64) {
      void chrome.storage.local.set({ [steamKey(player.player_id)]: id64 });
    }
    return id64;
  } catch {
    steamCache.set(player.player_id, null);
    return undefined;
  }
}

// ---- Leetify profile fetching (session cache only, throttled) ----

type ProfileEntry = { at: number; profile: LeetifyProfile | null };

const profileCache = new Map<string, ProfileEntry>();
const inFlight = new Map<string, Promise<LeetifyProfile | null>>();
let lastFetchAt = 0;

function profileKey(steam64: string): string {
  return `finLeetify:${steam64}`;
}

async function readSessionProfile(steam64: string): Promise<ProfileEntry | undefined> {
  const memo = profileCache.get(steam64);
  if (memo && Date.now() - memo.at < CACHE_TTL_MS) return memo;
  try {
    const stored = await chrome.storage.session.get(profileKey(steam64));
    const hit = stored[profileKey(steam64)] as ProfileEntry | undefined;
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      profileCache.set(steam64, hit);
      return hit;
    }
  } catch {
    // session storage unavailable — memory cache only
  }
  return undefined;
}

function rememberProfile(steam64: string, profile: LeetifyProfile | null): void {
  const entry: ProfileEntry = { at: Date.now(), profile };
  profileCache.set(steam64, entry);
  try {
    void chrome.storage.session.set({ [profileKey(steam64)]: entry });
  } catch {
    // memory cache only
  }
}

async function throttle(): Promise<void> {
  const wait = lastFetchAt + FETCH_GAP_MS - Date.now();
  lastFetchAt = Math.max(Date.now(), lastFetchAt + FETCH_GAP_MS);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

async function fetchProfile(steam64: string): Promise<LeetifyProfile | null> {
  const cached = await readSessionProfile(steam64);
  if (cached) return cached.profile;
  const running = inFlight.get(steam64);
  if (running) return running;
  const task = (async () => {
    await throttle();
    try {
      const response = await fetch(
        `${LEETIFY_BASE}/v3/profile?steam64_id=${encodeURIComponent(steam64)}`,
        { method: "GET" },
      );
      if (!response.ok) {
        // 404 = not tracked by Leetify; 429 = limited — negative-cache both
        // for the session, the next lobby retries after the TTL.
        rememberProfile(steam64, null);
        return null;
      }
      const profile = parseProfile(steam64, await response.json());
      rememberProfile(steam64, profile);
      return profile;
    } catch {
      rememberProfile(steam64, null);
      return null;
    } finally {
      inFlight.delete(steam64);
    }
  })();
  inFlight.set(steam64, task);
  return task;
}

// Collect what is available within the soft deadline; slower fetches keep
// running and land in the cache for the next poll tick (roles fill in
// progressively — same non-blocking pattern as captain drops).
export async function collectLeetifyProfiles(
  roster: RosterPlayer[],
  token: string | undefined,
  softDeadlineMs: number,
): Promise<Map<string, LeetifyProfile>> {
  const result = new Map<string, LeetifyProfile>();
  const work = roster.map(async (player) => {
    const steam64 = await resolveSteam64(player, token);
    if (!steam64) return;
    const profile = await fetchProfile(steam64);
    if (profile) result.set(player.player_id, profile);
  });
  await Promise.race([
    Promise.allSettled(work),
    new Promise((resolve) => setTimeout(resolve, softDeadlineMs)),
  ]);
  return result;
}
