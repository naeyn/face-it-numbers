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
import { fetchThisGame, isMatchFinished } from "./lib/match-stats";
import {
  CACHE_TTL_MS,
  FETCH_CONCURRENCY,
  HISTORY_SOFT_DEADLINE_MS,
  LABEL_HISTORY_PAGES,
  PLAYER_FETCH_CONCURRENCY,
  SAMPLE_LIMIT,
} from "./lib/constants";
import { FaceitApiError, faceitGet, mapPool } from "./lib/faceit-api";
import { nicknameFromPayload, nicknameFromToken } from "./lib/session-user";
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
let sessionNickCache: { token: string; nick: string; at: number } | undefined;

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
        message.myNickname,
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
  myNickname: string | undefined,
  swapped: boolean | undefined,
  pageToken: string | undefined,
): Promise<LobbyStatsResponse> {
  const token = await resolveToken(pageToken);
  const [match, tokenNickname] = await Promise.all([
    fetchMatch(matchId, token),
    resolveSessionNickname(token),
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
  const sessionNickname = pickRosterNickname(tokenNickname, myNickname, faction1, faction2);
  const myFaction = resolveMyFaction(
    faction1,
    faction2,
    sessionNickname,
    swapped ?? false,
  );
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
  let roles: LobbyStats["roles"] = [];
  let youWon: boolean | null = null;
  const historyGames = roster.map((player) => ({
    playerId: player.player_id,
    nickname: player.nickname,
    games: statsByPlayer.get(player.player_id)?.games ?? [],
  }));
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
      // Role pendants only on finished matches — partial mid-game counts
      // would mislabel against thresholds tuned for full matches.
      if (isMatchFinished(match.status ?? "")) {
        roles = assignRoleLabels(lines);
      }
      const youIds = new Set(youRoster.map((player) => player.player_id));
      const yours = lines.filter((line) => youIds.has(line.playerId));
      if (yours.length >= 3) {
        youWon = yours.filter((line) => line.won).length > yours.length / 2;
      }
    } catch {
      labels = [];
      roles = [];
    }
  }

  const data: LobbyStats = {
    matchId: match.match_id ?? matchId,
    status: match.status ?? "",
    myNickname: sessionNickname,
    myFaction,
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

async function resolveSessionNickname(token: string | undefined): Promise<string | undefined> {
  if (!token) return undefined;
  const fromJwt = nicknameFromToken(token);
  if (fromJwt) return fromJwt;
  if (
    sessionNickCache &&
    sessionNickCache.token === token &&
    Date.now() - sessionNickCache.at < CACHE_TTL_MS
  ) {
    return sessionNickCache.nick;
  }
  const nick = await fetchSessionNickname(token);
  if (nick) sessionNickCache = { token, nick, at: Date.now() };
  return nick;
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

async function fetchSessionNickname(token: string): Promise<string | undefined> {
  try {
    return nicknameFromPayload(await faceitGet("/users/v1/sessions/me", token));
  } catch {
    return undefined;
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

function resolveMyFaction(
  faction1: RosterPlayer[],
  faction2: RosterPlayer[],
  myNickname: string | undefined,
  swapped: boolean,
): FactionId {
  let faction: FactionId = "faction1";
  if (myNickname) {
    if (rosterHas(faction1, myNickname)) faction = "faction1";
    else if (rosterHas(faction2, myNickname)) faction = "faction2";
  }
  if (swapped) faction = faction === "faction1" ? "faction2" : "faction1";
  return faction;
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

async function itemsThrough(
  playerId: string,
  token: string | undefined,
  beforeMs: number,
  seedItems: ReturnType<typeof timeMatchesToItems> | undefined,
  now: number,
): Promise<ReturnType<typeof timeMatchesToItems>> {
  const cached = histCache.get(playerId);
  if (cached?.items && now - cached.at < CACHE_TTL_MS) return cached.items;

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
  histCache.set(playerId, { at: now, items: collected });
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
