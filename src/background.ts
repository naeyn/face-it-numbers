import {
  aggregateTeamMaps,
  matchTime,
  parseLifetimeMapStats,
  parsePlayerMapStats,
  timeMatchesToItems,
  type TimeMatch,
} from "./lib/aggregate";
import { fetchCaptainDrops } from "./lib/captain-drops";
import { assignGameLabels, priorGames, sameMatchId } from "./lib/game-labels";
import { assignRoleLabels } from "./lib/role-labels";
import { collectLeetifyProfiles } from "./lib/leetify";
import { fetchThisGame, isMatchFinished } from "./lib/match-stats";
import {
  CACHE_TTL_MS,
  FETCH_CONCURRENCY,
  HISTORY_SOFT_DEADLINE_MS,
  LABEL_HISTORY_PAGES,
  LEETIFY_SOFT_DEADLINE_MS,
  PLAYER_FETCH_CONCURRENCY,
  SAMPLE_LIMIT,
} from "./lib/constants";
import { FaceitApiError, faceitGet, mapPool } from "./lib/faceit-api";
import {
  nicknameFromPayload,
  nicknameFromToken,
  userIdFromPayload,
  userIdFromToken,
} from "./lib/session-user";
import {
  DEFAULT_CS2_POOL,
  KNOWN_MAPS,
  displayNameFor,
  isMapClassName,
  knownEntity,
  normalizeMapKey,
  uniqueEntities,
} from "./lib/maps";
import type {
  ExtensionMessage,
  FactionId,
  LobbyStats,
  LobbyStatsResponse,
  MapEntity,
  MatchDetails,
  PlayerHistory,
  RosterPlayer,
} from "./lib/types";

type CacheEntry = {
  at: number;
  items?: ReturnType<typeof timeMatchesToItems>;
  lifetime?: unknown;
};

const playerCache = new Map<string, CacheEntry>();
const histCache = new Map<string, CacheEntry>();
// Who the browser is logged in as. The nickname is what the panel shows; the
// player_id is what decides the side.
type Identity = { nickname?: string; playerId?: string };

const IDENTITY_KEY = "finIdentity";
let sessionIdentityCache: { token: string; identity: Identity; at: number } | undefined;

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === "OPEN_OPTIONS") {
      void chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "GET_LOBBY_STATS") {
      void getLobbyStats(
        message.matchId,
        { nickname: message.myNickname, playerId: message.myPlayerId },
        message.swapped,
        message.token,
      )
        .then(sendResponse)
        .catch((error: unknown) => {
          const messageText =
            error instanceof Error ? error.message : "Unknown error";
          const status = error instanceof FaceitApiError ? error.status : 0;
          const errorCode =
            status === 401 || status === 403
              ? "NOT_LOGGED_IN"
              : status === 404
                ? "MATCH_NOT_FOUND"
                : status === 429
                  ? "RATE_LIMITED"
                  : "API_ERROR";
          sendResponse({
            ok: false,
            error: errorCode,
            message: messageText,
          } satisfies LobbyStatsResponse);
        });
      return true;
    }
  },
);

async function resolveToken(fromPage?: string): Promise<string | undefined> {
  if (fromPage?.trim()) return fromPage.trim();
  const sites = ["https://www.faceit.com", "https://api.faceit.com"];
  for (const url of sites) {
    const cookie = await chrome.cookies.get({ url, name: "t" });
    if (cookie?.value) return cookie.value;
  }
  return undefined;
}

async function getLobbyStats(
  matchId: string,
  fromPage: Identity,
  swapped: boolean | undefined,
  pageToken: string | undefined,
): Promise<LobbyStatsResponse> {
  const token = await resolveToken(pageToken);
  const [match, session] = await Promise.all([
    fetchMatch(matchId, token),
    resolveSessionIdentity(token),
  ]);
  const faction1 = match.teams?.faction1?.roster ?? [];
  const faction2 = match.teams?.faction2?.roster ?? [];
  const pool = resolvePool(match);
  const dropped = new Set(
    (match.voting?.map?.drop ?? []).map((key) => normalizeMapKey(key, KNOWN_MAPS)),
  );
  const picked = new Set(
    (match.voting?.map?.pick ?? []).map((key) => normalizeMapKey(key, KNOWN_MAPS)),
  );

  const roster = [...faction1, ...faction2];
  // Session first — it comes from the logged-in token — then whatever the page
  // could read, then whoever we resolved last time, which is all that is left
  // once Faceit stops answering /sessions/me.
  const identities = [session, fromPage, await lastKnownIdentity()];
  const me = identifyMe(faction1, faction2, identities);
  const myFaction = applySwap(me.faction, swapped ?? false);
  // A manual swap is the user telling us the side; nothing left to flag.
  const myFactionKnown = me.known || (swapped ?? false);
  const sessionNickname =
    me.player?.nickname ??
    pickRosterNickname(session.nickname, fromPage.nickname, faction1, faction2);
  const youRoster = myFaction === "faction1" ? faction1 : faction2;
  const themRoster = myFaction === "faction1" ? faction2 : faction1;
  const enemyCaptain =
    myFaction === "faction1"
      ? match.teams.faction2.leader
      : match.teams.faction1.leader;

  const statsPromise = loadPlayerStats(roster, KNOWN_MAPS, token);
  const dropsPromise = fetchCaptainDrops(enemyCaptain, KNOWN_MAPS, token).catch(
    () => [] as LobbyStats["captainDrops"],
  );
  const statsByPlayer = await statsPromise;
  const captainDrops =
    (await Promise.race([
      dropsPromise,
      new Promise<LobbyStats["captainDrops"]>((resolve) => {
        setTimeout(() => resolve([]), 900);
      }),
    ])) ?? [];

  const youAgg = aggregateTeamMaps(youRoster, statsByPlayer, KNOWN_MAPS, dropped, picked);
  const themAgg = aggregateTeamMaps(themRoster, statsByPlayer, KNOWN_MAPS, dropped, picked);

  let labels: LobbyStats["labels"] = [];
  let youWon: boolean | null = null;
  const historyGames = roster.map((player) => ({
    playerId: player.player_id,
    nickname: player.nickname,
    games: statsByPlayer.get(player.player_id)?.games ?? [],
  }));
  // Role pendants are pre-match intel: Leetify career profiles first
  // (best-effort, soft deadline — slow fetches land next poll), Faceit
  // history tendencies as fallback. Independent of this match's status.
  const leetify = await collectLeetifyProfiles(
    roster,
    token,
    LEETIFY_SOFT_DEADLINE_MS,
  ).catch(() => new Map<string, never>());
  const roles: LobbyStats["roles"] = assignRoleLabels(historyGames, leetify);
  const shouldLabel = !/vot|ready|config|created|sched|check/i.test(
    match.status ?? "",
  );
  const matchAt =
    match.startedAt ??
    inferMatchAt(match.match_id ?? matchId, statsByPlayer);
  if (shouldLabel) {
    try {
      const lines = await fetchThisGame(match.match_id ?? matchId, KNOWN_MAPS, token);
      const asOf = isMatchFinished(match.status ?? "") ? matchAt : undefined;
      // Soft deadline: the as-of backfill can mean dozens of history
      // requests on an old room. If it is slow (rate limits), paint with the
      // shallow histories now — it keeps filling histCache in the background
      // and the next poll upgrades the labels.
      const labelHistories =
        asOf != null
          ? await Promise.race([
              historiesAsOf(
                roster,
                statsByPlayer,
                KNOWN_MAPS,
                token,
                match.match_id ?? matchId,
                asOf,
              ),
              new Promise<typeof statsByPlayer>((resolve) => {
                setTimeout(() => resolve(statsByPlayer), HISTORY_SOFT_DEADLINE_MS);
              }),
            ])
          : statsByPlayer;
      labels = assignGameLabels(
        match.match_id ?? matchId,
        lines,
        labelHistories,
        asOf,
      );
      const youIds = new Set(youRoster.map((player) => player.player_id));
      const yours = lines.filter((line) => youIds.has(line.playerId));
      if (yours.length >= 3) {
        youWon = yours.filter((line) => line.won).length > yours.length / 2;
      }
    } catch {
      labels = [];
    }
  }

  const data: LobbyStats = {
    matchId: match.match_id ?? matchId,
    status: match.status ?? "",
    myNickname: sessionNickname,
    myFaction,
    myFactionKnown,
    you: {
      faction: myFaction,
      name:
        myFaction === "faction1"
          ? match.teams.faction1.name ?? "You"
          : match.teams.faction2.name ?? "You",
      players: youRoster,
      maps: youAgg.maps,
      insight: youAgg.insight,
    },
    them: {
      faction: myFaction === "faction1" ? "faction2" : "faction1",
      name:
        myFaction === "faction1"
          ? match.teams.faction2.name ?? "Them"
          : match.teams.faction1.name ?? "Them",
      players: themRoster,
      maps: themAgg.maps,
      insight: themAgg.insight,
    },
    maps: pool,
    captainDrops,
    labels,
    roles,
    historyGames,
    youWon,
    matchAt,
  };

  return { ok: true, data };
}

async function resolveSessionIdentity(token: string | undefined): Promise<Identity> {
  if (!token) return {};
  const fromJwt: Identity = {
    nickname: nicknameFromToken(token),
    playerId: userIdFromToken(token),
  };
  if (fromJwt.nickname && fromJwt.playerId) {
    void rememberIdentity(fromJwt);
    return fromJwt;
  }
  if (
    sessionIdentityCache &&
    sessionIdentityCache.token === token &&
    Date.now() - sessionIdentityCache.at < CACHE_TTL_MS
  ) {
    return merge(fromJwt, sessionIdentityCache.identity);
  }
  const fetched = await fetchSessionIdentity(token);
  const identity = merge(fromJwt, fetched);
  if (fetched.nickname || fetched.playerId) {
    sessionIdentityCache = { token, identity, at: Date.now() };
  }
  void rememberIdentity(identity);
  return identity;
}

function merge(primary: Identity, fallback: Identity): Identity {
  return {
    nickname: primary.nickname ?? fallback.nickname,
    playerId: primary.playerId ?? fallback.playerId,
  };
}

/**
 * The service worker is torn down between polls, so the in-memory cache above
 * is usually cold. Keeping the last resolved account on disk means a lobby
 * opened while /sessions/me is rate limiting still lands on the right side
 * instead of silently defaulting to faction1.
 */
async function rememberIdentity(identity: Identity): Promise<void> {
  if (!identity.playerId && !identity.nickname) return;
  try {
    await chrome.storage.local.set({ [IDENTITY_KEY]: identity });
  } catch {
    // Best effort: a failed write only costs us the fallback.
  }
}

async function lastKnownIdentity(): Promise<Identity> {
  try {
    const stored = await chrome.storage.local.get(IDENTITY_KEY);
    const value = stored[IDENTITY_KEY] as unknown;
    return {
      nickname: nicknameFromPayload(value),
      playerId: userIdFromPayload(value),
    };
  } catch {
    return {};
  }
}

function pickRosterNickname(
  session: string | undefined,
  hint: string | undefined,
  faction1: RosterPlayer[],
  faction2: RosterPlayer[],
): string | undefined {
  if (session && (rosterHas(faction1, session) || rosterHas(faction2, session))) {
    return session;
  }
  if (hint && (rosterHas(faction1, hint) || rosterHas(faction2, hint))) {
    return hint;
  }
  return session ?? hint;
}

async function fetchSessionIdentity(token: string): Promise<Identity> {
  try {
    const payload = await faceitGet("/users/v1/sessions/me", token);
    return {
      nickname: nicknameFromPayload(payload),
      playerId: userIdFromPayload(payload),
    };
  } catch {
    return {};
  }
}

async function fetchMatch(
  matchId: string,
  token: string | undefined,
): Promise<MatchDetails> {
  const raw = await faceitGet(`/match/v2/match/${matchId}`, token);
  return normalizeMatch(raw, matchId);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asMatchList(raw: unknown): TimeMatch[] {
  if (Array.isArray(raw)) return raw as TimeMatch[];
  const record = asRecord(raw);
  if (Array.isArray(record?.items)) return record.items as TimeMatch[];
  return [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asUnixMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 0) {
      return asNum < 1e12 ? asNum * 1000 : asNum;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function rosterElo(row: Record<string, unknown>): number | undefined {
  const direct =
    asNumber(row.elo) ??
    asNumber(row.faceit_elo) ??
    asNumber(row.faceitElo) ??
    asNumber(row.gameElo);
  if (direct != null && direct > 80) return direct;
  const games = asRecord(row.games);
  const cs2 = asRecord(games?.cs2) ?? asRecord(games?.csgo);
  const nested = asNumber(cs2?.faceit_elo) ?? asNumber(cs2?.faceitElo);
  if (nested != null && nested > 80) return nested;
  return undefined;
}

function normalizeRoster(raw: unknown): RosterPlayer[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const row = asRecord(entry);
    if (!row) return [];
    const playerId = asString(row.id) ?? asString(row.player_id);
    const nickname = asString(row.nickname);
    if (!playerId || !nickname) return [];
    const games = asRecord(row.games);
    const cs2 = asRecord(games?.cs2);
    const steam64 =
      asString(row.game_player_id) ??
      asString(row.gamePlayerId) ??
      asString(cs2?.game_player_id) ??
      asString(cs2?.game_id);
    return [
      {
        player_id: playerId,
        nickname,
        avatar: asString(row.avatar),
        game_skill_level:
          typeof row.gameSkillLevel === "number"
            ? row.gameSkillLevel
            : typeof row.game_skill_level === "number"
              ? row.game_skill_level
              : undefined,
        elo: rosterElo(row),
        steam64: steam64 && /^\d{17}$/.test(steam64) ? steam64 : undefined,
      },
    ];
  });
}

function normalizeEntities(raw: unknown): MapEntity[] {
  if (!Array.isArray(raw)) return [];
  return uniqueEntities(
    raw.flatMap((entry) => {
      const row = asRecord(entry);
      if (!row) return [];
      const className =
        asString(row.class_name) ?? asString(row.guid) ?? asString(row.game_map_id);
      if (!className || className.length > 40 || !isMapClassName(className)) return [];
      const key = normalizeMapKey(className, KNOWN_MAPS);
      const known = knownEntity(key);
      const name =
        asString(row.name) ?? known?.name ?? displayNameFor(key, KNOWN_MAPS);
      return [
        {
          class_name: key,
          name,
          image_sm: asString(row.image_sm) ?? known?.image_sm,
          image_lg: asString(row.image_lg) ?? known?.image_lg,
        },
      ];
    }),
  );
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function normalizeMatch(raw: unknown, matchId: string): MatchDetails {
  const payload = asRecord(raw) ?? {};
  const teams = asRecord(payload.teams) ?? {};
  const faction1 = asRecord(teams.faction1) ?? {};
  const faction2 = asRecord(teams.faction2) ?? {};
  const voting = asRecord(payload.voting);
  const votingMap = asRecord(voting?.map);

  return {
    match_id: asString(payload.id) ?? asString(payload.match_id) ?? matchId,
    game: asString(payload.game) ?? "cs2",
    status: asString(payload.status) ?? asString(payload.state) ?? "",
    startedAt:
      asUnixMs(payload.startedAt) ??
      asUnixMs(payload.started_at) ??
      asUnixMs(payload.finishedAt) ??
      asUnixMs(payload.finished_at) ??
      asUnixMs(payload.createdAt) ??
      asUnixMs(payload.created_at),
    teams: {
      faction1: {
        name: asString(faction1.name),
        leader: asString(faction1.leader),
        roster: normalizeRoster(faction1.roster),
      },
      faction2: {
        name: asString(faction2.name),
        leader: asString(faction2.leader),
        roster: normalizeRoster(faction2.roster),
      },
    },
    voting: {
      map: {
        entities: normalizeEntities(votingMap?.entities),
        pick: stringList(votingMap?.pick),
        drop: stringList(votingMap?.drop),
      },
    },
  };
}

function resolvePool(match: MatchDetails): MapEntity[] {
  const voting = match.voting?.map;
  const fromEntities = (voting?.entities ?? []).filter(
    (entity) => entity.class_name && entity.name,
  );
  const fromVotes = [...(voting?.pick ?? []), ...(voting?.drop ?? [])]
    .filter(isMapClassName)
    .map(
      (key) =>
        knownEntity(key) ?? {
          class_name: normalizeMapKey(key, KNOWN_MAPS),
          name: displayNameFor(key, KNOWN_MAPS),
        },
    );
  const pool = uniqueEntities([...fromEntities, ...fromVotes]);
  if (pool.length >= 4) return pool;
  return DEFAULT_CS2_POOL;
}

function nicknamesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function rosterHas(roster: RosterPlayer[], nickname: string): boolean {
  return roster.some((player) => nicknamesEqual(player.nickname, nickname));
}

function findById(roster: RosterPlayer[], playerId: string): RosterPlayer | undefined {
  const id = playerId.trim().toLowerCase();
  return roster.find((player) => player.player_id?.trim().toLowerCase() === id);
}

function findByNick(roster: RosterPlayer[], nickname: string): RosterPlayer | undefined {
  return roster.find((player) => nicknamesEqual(player.nickname, nickname));
}

type Me = { faction: FactionId; player?: RosterPlayer; known: boolean };

/**
 * Every id is tried before any nickname: an id hit is proof, while a nickname
 * hit is a display-name comparison that a rename or a lookalike can defeat.
 * Falling through to faction1 is a guess, and `known` says so, so the panel
 * can flag it instead of quietly showing the enemy team as yours.
 */
function identifyMe(
  faction1: RosterPlayer[],
  faction2: RosterPlayer[],
  candidates: Identity[],
): Me {
  const passes: Array<{
    value: (identity: Identity) => string | undefined;
    find: (roster: RosterPlayer[], value: string) => RosterPlayer | undefined;
  }> = [
    { value: (identity) => identity.playerId, find: findById },
    { value: (identity) => identity.nickname, find: findByNick },
  ];
  for (const pass of passes) {
    for (const candidate of candidates) {
      const value = pass.value(candidate);
      if (!value) continue;
      const mine = pass.find(faction1, value);
      if (mine) return { faction: "faction1", player: mine, known: true };
      const theirs = pass.find(faction2, value);
      if (theirs) return { faction: "faction2", player: theirs, known: true };
    }
  }
  return { faction: "faction1", known: false };
}

function applySwap(faction: FactionId, swapped: boolean): FactionId {
  if (!swapped) return faction;
  return faction === "faction1" ? "faction2" : "faction1";
}

function inferMatchAt(
  matchId: string,
  statsByPlayer: Map<string, PlayerHistory>,
): number | undefined {
  for (const history of statsByPlayer.values()) {
    const hit = history.games.find(
      (game) => game.matchId && sameMatchId(game.matchId, matchId),
    );
    if (hit?.at) return hit.at;
  }
  return undefined;
}

function histCacheKey(playerId: string): string {
  return `finHist:${playerId}`;
}

function rememberHist(playerId: string, entry: CacheEntry): void {
  histCache.set(playerId, entry);
  void chrome.storage.session
    .set({ [histCacheKey(playerId)]: entry })
    .catch(() => {});
}

// The MV3 worker suspends after ~30s idle and takes histCache with it;
// without the session copy every wake-up re-runs the full as-of backfill.
async function readHistCache(
  playerId: string,
  now: number,
): Promise<CacheEntry | undefined> {
  const cached = histCache.get(playerId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached;
  const session = await chrome.storage.session.get(histCacheKey(playerId));
  const stored = session[histCacheKey(playerId)] as CacheEntry | undefined;
  if (stored && now - stored.at < CACHE_TTL_MS) {
    histCache.set(playerId, stored);
    return stored;
  }
  return undefined;
}

async function itemsThrough(
  playerId: string,
  token: string | undefined,
  beforeMs: number,
  seedItems: ReturnType<typeof timeMatchesToItems> | undefined,
  now: number,
): Promise<ReturnType<typeof timeMatchesToItems>> {
  const cached = await readHistCache(playerId, now);
  if (cached?.items) return cached.items;

  const collected = [...(seedItems ?? [])];
  const priorCount = () =>
    collected.filter((item) => {
      const time = matchTime(item.stats);
      return time > 0 && time < beforeMs;
    }).length;

  const startPage = seedItems && seedItems.length > 0 ? 1 : 0;
  for (let page = startPage; page < LABEL_HISTORY_PAGES; page += 1) {
    if (priorCount() >= SAMPLE_LIMIT) break;
    try {
      const raw = await faceitGet(
        `/stats/v1/stats/time/users/${playerId}/games/cs2?page=${page}&size=${SAMPLE_LIMIT}`,
        token,
      );
      const matches = asMatchList(raw);
      if (matches.length === 0) break;
      collected.push(...timeMatchesToItems(matches));
      if (matches.length < SAMPLE_LIMIT) break;
    } catch {
      break;
    }
  }
  rememberHist(playerId, { at: now, items: collected });
  return collected;
}

async function historiesAsOf(
  roster: RosterPlayer[],
  statsByPlayer: Map<string, PlayerHistory>,
  pool: MapEntity[],
  token: string | undefined,
  matchId: string,
  matchAt: number,
): Promise<Map<string, PlayerHistory>> {
  const now = Date.now();
  const next = new Map(statsByPlayer);
  await mapPool(roster, FETCH_CONCURRENCY, async (player) => {
    const seed = statsByPlayer.get(player.player_id);
    if (!seed) return;
    if (priorGames(seed.games, matchId, matchAt).length >= SAMPLE_LIMIT) return;
    const cached = await readCache(player.player_id, now);
    const items = await itemsThrough(
      player.player_id,
      token,
      matchAt,
      cached?.items,
      now,
    );
    const parsed = parsePlayerMapStats(player, items, pool);
    next.set(player.player_id, { ...seed, games: parsed.games });
  });
  return next;
}

async function loadPlayerStats(
  roster: RosterPlayer[],
  pool: MapEntity[],
  token: string | undefined,
): Promise<Map<string, PlayerHistory>> {
  const now = Date.now();
  const unique = new Map<string, RosterPlayer>();
  for (const player of roster) unique.set(player.player_id, player);

  const parsed = await mapPool(
    [...unique.values()],
    PLAYER_FETCH_CONCURRENCY,
    async (player) => ({
      playerId: player.player_id,
      history: await statsForPlayer(player, pool, token, now),
    }),
  );

  const result = new Map<string, PlayerHistory>();
  for (const row of parsed) result.set(row.playerId, row.history);
  return result;
}

function playerCacheKey(playerId: string): string {
  return `finPlayer:${playerId}`;
}

function rememberPlayer(playerId: string, entry: CacheEntry): void {
  playerCache.set(playerId, entry);
  void chrome.storage.session.set({ [playerCacheKey(playerId)]: entry });
}

async function readCache(playerId: string, now: number): Promise<CacheEntry | undefined> {
  const cached = playerCache.get(playerId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached;
  const session = await chrome.storage.session.get(playerCacheKey(playerId));
  const stored = session[playerCacheKey(playerId)] as CacheEntry | undefined;
  if (stored && now - stored.at < CACHE_TTL_MS) {
    playerCache.set(playerId, stored);
    return stored;
  }
  return undefined;
}

async function statsForPlayer(
  player: RosterPlayer,
  pool: MapEntity[],
  token: string | undefined,
  now: number,
): Promise<PlayerHistory> {
  const cached = await readCache(player.player_id, now);
  if (cached) {
    if (cached.lifetime) return parseLifetimeMapStats(player, cached.lifetime, pool);
    if (cached.items) return parsePlayerMapStats(player, cached.items, pool);
  }

  try {
    const raw = await faceitGet(
      `/stats/v1/stats/time/users/${player.player_id}/games/cs2?page=0&size=${SAMPLE_LIMIT}`,
      token,
    );
    const matches = asMatchList(raw);
    const items = timeMatchesToItems(matches);
    if (items.length === 0) {
      return lifetimeFallback(player, pool, token, now);
    }
    rememberPlayer(player.player_id, { at: now, items });
    return parsePlayerMapStats(player, items, pool);
  } catch (error) {
    if (error instanceof FaceitApiError && error.status === 404) {
      return lifetimeFallback(player, pool, token, now);
    }
    try {
      return await lifetimeFallback(player, pool, token, now);
    } catch {
      throw error;
    }
  }
}

async function lifetimeFallback(
  player: RosterPlayer,
  pool: MapEntity[],
  token: string | undefined,
  now: number,
): Promise<PlayerHistory> {
  const raw = await faceitGet(
    `/stats/v1/stats/users/${player.player_id}/games/cs2`,
    token,
  );
  rememberPlayer(player.player_id, { at: now, lifetime: raw });
  return parseLifetimeMapStats(player, raw, pool);
}
