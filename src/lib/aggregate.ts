import { RECENT_FORM } from "./constants";
import { displayNameFor, normalizeMapKey } from "./maps";
import type {
  HistoryGame,
  MapEntity,
  PlayerHistory,
  PlayerMapStat,
  PlayerMatchItem,
  RosterPlayer,
  TeamInsight,
  TeamMapStat,
} from "./types";
import { averageEloDelta, stackOverlap } from "./insights";

function getStat(
  stats: Record<string, string>,
  ...keys: string[]
): string | undefined {
  const entries = Object.entries(stats);
  for (const key of keys) {
    const exact = stats[key];
    if (exact != null && exact !== "") return exact;
    const found = entries.find(
      ([name]) => name.toLowerCase() === key.toLowerCase(),
    );
    if (found && found[1] !== "") return found[1];
  }
  return undefined;
}

export function matchTime(stats: Record<string, string>): number {
  const raw = getStat(stats, "date", "Date");
  if (!raw) return 0;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum !== 0) {
    return Math.abs(asNum) < 1e12 ? asNum * 1000 : asNum;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Newest-first snapshots → net change. Tiny values are treated as per-match gains. */
function eloSwing(elos: number[]): number | null {
  if (elos.length === 0) return null;
  const maxAbs = Math.max(...elos.map((value) => Math.abs(value)));
  if (maxAbs <= 80) return elos.reduce((sum, value) => sum + value, 0);
  if (elos.length < 2) return null;
  return elos[0] - elos[elos.length - 1];
}

function isWin(result: string): boolean {
  const value = result.trim().toLowerCase();
  return value === "1" || value === "win" || value === "true" || value === "won";
}

function isFiveVsFive(mode: string | undefined): boolean {
  if (!mode) return true;
  const compact = mode.toLowerCase().replace(/\s+/g, "");
  if (compact.includes("1v1") || compact.includes("2v2")) return false;
  return compact.includes("5v5") || compact === "5" || compact.includes("matchmaking");
}

/** Faceit last-30 `i20` is often total damage, not ADR. CSGO ADR is typically 40–120. */
function asAdr(
  raw: number,
  rounds: number,
  kills: number,
  kr: number | null,
  elo: number,
): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw <= 200) return raw;
  if (Number.isFinite(elo) && elo > 80 && Math.abs(raw - elo) < 3) return null;
  let played = Number.isFinite(rounds) && rounds >= 8 ? rounds : Number.NaN;
  if (
    !Number.isFinite(played) &&
    kr != null &&
    kr > 0.05 &&
    Number.isFinite(kills) &&
    kills > 0
  ) {
    played = kills / kr;
  }
  if (!Number.isFinite(played) || played < 8) return null;
  const adr = raw / played;
  if (adr < 30 || adr > 200) return null;
  return adr;
}

function emptyPlayerMap(
  player: RosterPlayer,
  mapKey: string,
  sampleSize: number,
): PlayerMapStat {
  return {
    playerId: player.player_id,
    nickname: player.nickname,
    mapKey,
    games: 0,
    wins: 0,
    winRate: null,
    playRate: 0,
    sampleSize,
    kd: null,
    recent: [],
  };
}

export function parsePlayerMapStats(
  player: RosterPlayer,
  items: PlayerMatchItem[],
  pool: MapEntity[],
): PlayerHistory {
  const fiveVFive = items.filter((item) =>
    isFiveVsFive(getStat(item.stats, "Game Mode", "game_mode", "Mode")),
  );
  const sampleSize = fiveVFive.length;
  const counts = new Map<
    string,
    { games: number; wins: number; kdSum: number; kdN: number; recent: boolean[] }
  >();
  const matchIds: string[] = [];
  const elos: number[] = [];
  const games: HistoryGame[] = [];

  const sorted = [...fiveVFive].sort(
    (a, b) => matchTime(b.stats) - matchTime(a.stats),
  );

  for (const item of sorted) {
    const matchId = getStat(item.stats, "Match Id", "matchId", "match_id");
    if (matchId) matchIds.push(matchId);
    const elo = Number(getStat(item.stats, "elo", "Elo"));
    if (Number.isFinite(elo) && elo !== 0) elos.push(elo);

    const rawMap = getStat(item.stats, "Map", "map", "Map Name");
    if (!rawMap) continue;
    const mapKey = normalizeMapKey(rawMap, pool);
    const result = getStat(item.stats, "Result", "result", "Win") ?? "0";
    const won = isWin(result);
    const kd = Number(
      getStat(item.stats, "K/D Ratio", "c2", "kd") ??
        Number.NaN,
    );
    const adrRaw = Number(getStat(item.stats, "ADR", "adr", "i20") ?? Number.NaN);
    const kills = Number(getStat(item.stats, "Kills", "i6") ?? Number.NaN);
    const deaths = Number(getStat(item.stats, "Deaths", "i8") ?? Number.NaN);
    const hsRaw = Number(
      getStat(item.stats, "Headshots %", "i16", "c4") ?? Number.NaN,
    );
    const hsCount = Number(getStat(item.stats, "Headshots", "i9") ?? Number.NaN);
    const rounds = Number(getStat(item.stats, "Rounds", "i18") ?? Number.NaN);
    const krRaw = Number(getStat(item.stats, "K/R Ratio", "c3", "kr") ?? Number.NaN);
    let hsPct: number | null = null;
    if (Number.isFinite(hsRaw) && hsRaw > 0) {
      hsPct = hsRaw > 1.5 ? hsRaw / 100 : hsRaw;
    } else if (Number.isFinite(hsCount) && Number.isFinite(kills) && kills > 0) {
      hsPct = hsCount / kills;
    }
    const kr =
      Number.isFinite(krRaw) && krRaw > 0
        ? krRaw
        : Number.isFinite(kills) && Number.isFinite(rounds) && rounds > 0
          ? kills / rounds
          : null;
    const adr = asAdr(adrRaw, rounds, kills, kr, elo);
    games.push({
      matchId: matchId ?? "",
      mapKey,
      kd: Number.isFinite(kd) && kd >= 0 ? kd : deaths > 0 && Number.isFinite(kills) ? kills / deaths : null,
      adr,
      hsPct: hsPct != null && hsPct >= 0 && hsPct <= 1 ? hsPct : null,
      kr: kr != null && Number.isFinite(kr) && kr >= 0 ? kr : null,
      won,
      at: matchTime(item.stats),
    });
    const current = counts.get(mapKey) ?? {
      games: 0,
      wins: 0,
      kdSum: 0,
      kdN: 0,
      recent: [],
    };
    current.games += 1;
    if (won) current.wins += 1;
    if (Number.isFinite(kd) && kd >= 0) {
      current.kdSum += kd;
      current.kdN += 1;
    }
    if (current.recent.length < RECENT_FORM) current.recent.push(won);
    counts.set(mapKey, current);
  }

  const byMap = new Map<string, PlayerMapStat>();
  for (const entity of pool) {
    const count = counts.get(entity.class_name);
    if (!count) {
      byMap.set(entity.class_name, emptyPlayerMap(player, entity.class_name, sampleSize));
      continue;
    }
    byMap.set(entity.class_name, {
      playerId: player.player_id,
      nickname: player.nickname,
      mapKey: entity.class_name,
      games: count.games,
      wins: count.wins,
      winRate: count.games > 0 ? count.wins / count.games : null,
      playRate: sampleSize > 0 ? count.games / sampleSize : 0,
      sampleSize,
      kd: count.kdN > 0 ? count.kdSum / count.kdN : null,
      recent: count.recent,
    });
  }

  const eloDelta = eloSwing(elos);
  const elo = elos[0] != null && elos[0] > 80 ? elos[0] : null;

  return { byMap, matchIds, games, elo, eloDelta };
}

export type TimeMatch = {
  i1?: string;
  i6?: string | number;
  i8?: string | number;
  i9?: string | number;
  i10?: string | number;
  i16?: string | number;
  i18?: string | number;
  c2?: string | number;
  c3?: string | number;
  c4?: string | number;
  map?: string;
  result?: string | number;
  gameMode?: string;
  mode?: string;
  matchId?: string;
  match_id?: string;
  elo?: string | number;
  i20?: string | number;
  adr?: string | number;
  date?: string | number;
};

export function timeMatchesToItems(matches: TimeMatch[]): PlayerMatchItem[] {
  return matches.map((match) => {
    const kills = Number(match.i6);
    const deaths = Number(match.i8);
    const kdFromRecord = Number(match.c2);
    const kd =
      Number.isFinite(kdFromRecord) && kdFromRecord > 0
        ? kdFromRecord
        : deaths > 0 && Number.isFinite(kills)
          ? kills / deaths
          : "";
    return {
      stats: {
        Map: String(match.i1 ?? match.map ?? ""),
        Result: String(match.i10 ?? match.result ?? "0"),
        "Game Mode": String(match.gameMode ?? match.mode ?? "5v5"),
        matchId: String(match.matchId ?? match.match_id ?? ""),
        elo: String(match.elo ?? ""),
        date: String(match.date ?? ""),
        c2: String(kd),
        ADR: String(match.i20 ?? match.adr ?? ""),
        Kills: String(match.i6 ?? ""),
        Deaths: String(match.i8 ?? ""),
        Headshots: String(match.i9 ?? ""),
        "Headshots %": String(match.i16 ?? match.c4 ?? ""),
        Rounds: String(match.i18 ?? ""),
        "K/R Ratio": String(match.c3 ?? ""),
      },
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function lifetimeGamesWins(raw: Record<string, unknown>): {
  games: number;
  wins: number;
  kd: number | null;
} {
  const games = Number(raw.m1 ?? raw.Matches ?? raw.games ?? 0);
  const wins = Number(raw.m2 ?? raw.Wins ?? raw.wins ?? 0);
  const winRate = Number(raw.k6 ?? raw["Win Rate %"] ?? raw.winRate);
  const kdRaw = Number(raw.k5 ?? raw["Average K/D Ratio"] ?? raw.kd);
  const kd = Number.isFinite(kdRaw) && kdRaw > 0 ? kdRaw : null;
  if (games > 0 && wins >= 0) return { games, wins, kd };
  if (games > 0 && Number.isFinite(winRate)) {
    return { games, wins: Math.round((winRate / 100) * games), kd };
  }
  return { games: Number.isFinite(games) ? games : 0, wins: 0, kd };
}

export function parseLifetimeMapStats(
  player: RosterPlayer,
  raw: unknown,
  pool: MapEntity[],
): PlayerHistory {
  const root = asRecord(raw);
  const segments = Array.isArray(root?.segments)
    ? (root.segments as unknown[])
    : [];

  const counts = new Map<string, { games: number; wins: number; kd: number | null }>();

  for (const segment of segments) {
    const row = asRecord(segment);
    if (!row) continue;

    const id = asRecord(row._id);
    const nested = asRecord(row.segments);
    const mode = String(id?.gameMode ?? row.mode ?? "");
    if (mode && !mode.toLowerCase().includes("5v5")) continue;

    if (nested) {
      for (const [mapKey, stats] of Object.entries(nested)) {
        const statRow = asRecord(stats);
        if (!statRow) continue;
        counts.set(normalizeMapKey(mapKey, pool), lifetimeGamesWins(statRow));
      }
      continue;
    }

    const label = String(row.label ?? row.name ?? "");
    const stats = asRecord(row.stats) ?? row;
    if (!label) continue;
    counts.set(normalizeMapKey(label, pool), lifetimeGamesWins(stats));
  }

  const sampleSize = [...counts.values()].reduce((sum, row) => sum + row.games, 0);
  const byMap = new Map<string, PlayerMapStat>();
  for (const entity of pool) {
    const count = counts.get(entity.class_name) ?? { games: 0, wins: 0, kd: null };
    byMap.set(entity.class_name, {
      playerId: player.player_id,
      nickname: player.nickname,
      mapKey: entity.class_name,
      games: count.games,
      wins: count.wins,
      winRate: count.games > 0 ? count.wins / count.games : null,
      playRate: sampleSize > 0 ? count.games / sampleSize : 0,
      sampleSize,
      kd: count.kd,
      recent: [],
    });
  }
  return { byMap, matchIds: [], games: [], elo: null, eloDelta: null };
}

export function aggregateTeamMaps(
  players: RosterPlayer[],
  playerStats: Map<string, PlayerHistory>,
  pool: MapEntity[],
  dropped: Set<string>,
  picked: Set<string>,
): { maps: TeamMapStat[]; insight: TeamInsight } {
  const maps = pool.map((entity) => {
    const perPlayer = players.map((player) => {
      return (
        playerStats.get(player.player_id)?.byMap.get(entity.class_name) ??
        emptyPlayerMap(player, entity.class_name, 0)
      );
    });

    const games = perPlayer.reduce((sum, row) => sum + row.games, 0);
    const wins = perPlayer.reduce((sum, row) => sum + row.wins, 0);
    const playRate =
      perPlayer.length > 0
        ? perPlayer.reduce((sum, row) => sum + row.playRate, 0) / perPlayer.length
        : 0;
    const kdParts = perPlayer.filter((row) => row.kd != null);
    const kd =
      kdParts.length > 0
        ? kdParts.reduce((sum, row) => sum + (row.kd ?? 0), 0) / kdParts.length
        : null;

    return {
      mapKey: entity.class_name,
      displayName: displayNameFor(entity.class_name, pool),
      games,
      wins,
      winRate: games > 0 ? wins / games : null,
      playRate,
      dropped: dropped.has(entity.class_name),
      picked: picked.has(entity.class_name),
      kd,
      players: perPlayer,
    };
  });

  const stack = stackOverlap(
    players.map((player) => ({
      nickname: player.nickname,
      matchIds: playerStats.get(player.player_id)?.matchIds ?? [],
    })),
  );

  return {
    maps,
    insight: {
      stack: stack.count,
      stackNames: stack.names,
      elo: averageEloDelta(
        players.map((player) => {
          const fromRoster = player.elo;
          if (typeof fromRoster === "number" && fromRoster > 80) return fromRoster;
          return playerStats.get(player.player_id)?.elo;
        }),
      ),
      eloDelta: averageEloDelta(
        players.map((player) => playerStats.get(player.player_id)?.eloDelta),
      ),
    },
  };
}
