import { CACHE_TTL_MS } from "./constants";
import { FaceitApiError, faceitGet } from "./faceit-api";
import { normalizeMapKey } from "./maps";
import type { MapEntity, RoleStats } from "./types";

export type ThisGameLine = {
  playerId: string;
  nickname: string;
  teamKey: string;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  adr: number | null;
  won: boolean;
  mapKey: string;
  roleStats?: RoleStats;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value != null ? String(value) : "";
}

function pickNum(stats: Record<string, unknown>, ...keys: string[]): number | null {
  const entries = Object.entries(stats);
  for (const key of keys) {
    if (stats[key] != null) {
      const parsed = num(stats[key]);
      if (parsed != null) return parsed;
    }
    const found = entries.find(([name]) => name.toLowerCase() === key.toLowerCase());
    if (found) {
      const parsed = num(found[1]);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a + b;
}

// Field names per Faceit's CS2 advanced stats; alias-heavy on purpose — any
// key that is absent in the live payload leaves the stat null and the roles
// that need it simply never fire.
function parseRoleStats(stats: Record<string, unknown>): RoleStats {
  return {
    rounds: null,
    entryCount: pickNum(stats, "Entry Count", "Match Entry Count", "First Kills"),
    entryWins: pickNum(stats, "Entry Wins", "Match Entry Wins", "First Kill Wins"),
    sniperKills: pickNum(stats, "Sniper Kills", "Total Sniper Kills"),
    utilityDamage: pickNum(stats, "Utility Damage", "Total Utility Damage"),
    enemiesFlashed: pickNum(stats, "Enemies Flashed", "Total Enemies Flashed"),
    flashSuccesses: pickNum(stats, "Flash Successes", "Total Flash Successes"),
    oneV1Wins: pickNum(stats, "1v1Wins", "Match 1v1 Wins", "1v1 Wins"),
    oneV1Count: pickNum(stats, "1v1Count", "Match 1v1 Count", "1v1 Count"),
    oneV2Wins: pickNum(stats, "1v2Wins", "Match 1v2 Wins", "1v2 Wins"),
    oneV2Count: pickNum(stats, "1v2Count", "Match 1v2 Count", "1v2 Count"),
    tripleKills: pickNum(stats, "Triple Kills", "i13"),
    quadroKills: pickNum(stats, "Quadro Kills", "i14"),
    pentaKills: pickNum(stats, "Penta Kills", "i15"),
    mvps: pickNum(stats, "MVPs", "i12"),
    pistolKills: pickNum(stats, "Pistol Kills"),
    knifeKills: pickNum(stats, "Knife Kills"),
    zeusKills: pickNum(stats, "Zeus Kills"),
    headshots: pickNum(stats, "Headshots", "i9"),
    headshotPct: pickNum(stats, "Headshots %", "i16", "c4"),
  };
}

function mergeRoleStats(a: RoleStats, b: RoleStats): RoleStats {
  return {
    rounds: addNullable(a.rounds, b.rounds),
    entryCount: addNullable(a.entryCount, b.entryCount),
    entryWins: addNullable(a.entryWins, b.entryWins),
    sniperKills: addNullable(a.sniperKills, b.sniperKills),
    utilityDamage: addNullable(a.utilityDamage, b.utilityDamage),
    enemiesFlashed: addNullable(a.enemiesFlashed, b.enemiesFlashed),
    flashSuccesses: addNullable(a.flashSuccesses, b.flashSuccesses),
    oneV1Wins: addNullable(a.oneV1Wins, b.oneV1Wins),
    oneV1Count: addNullable(a.oneV1Count, b.oneV1Count),
    oneV2Wins: addNullable(a.oneV2Wins, b.oneV2Wins),
    oneV2Count: addNullable(a.oneV2Count, b.oneV2Count),
    tripleKills: addNullable(a.tripleKills, b.tripleKills),
    quadroKills: addNullable(a.quadroKills, b.quadroKills),
    pentaKills: addNullable(a.pentaKills, b.pentaKills),
    mvps: addNullable(a.mvps, b.mvps),
    pistolKills: addNullable(a.pistolKills, b.pistolKills),
    knifeKills: addNullable(a.knifeKills, b.knifeKills),
    zeusKills: addNullable(a.zeusKills, b.zeusKills),
    headshots: addNullable(a.headshots, b.headshots),
    // percentage across maps: recomputed from headshots/kills at assignment
    // time when counts exist; averaging is the honest fallback
    headshotPct:
      a.headshotPct != null && b.headshotPct != null
        ? (a.headshotPct + b.headshotPct) / 2
        : (a.headshotPct ?? b.headshotPct),
  };
}

function teamWon(
  team: Record<string, unknown>,
  winner: string,
  teamKey: string,
): boolean {
  const stats = asRecord(team.team_stats) ?? asRecord(team.stats) ?? {};
  const flag = str(stats["Team Win"] ?? stats.Win ?? stats.win).toLowerCase();
  if (flag === "1" || flag === "true" || flag === "win") return true;
  if (flag === "0" || flag === "false" || flag === "loss") return false;
  if (!winner) return false;
  const lower = winner.toLowerCase();
  return (
    teamKey.toLowerCase() === lower ||
    str(team.team_id).toLowerCase() === lower ||
    str(team.name).toLowerCase() === lower
  );
}

function parseRounds(raw: unknown, pool: MapEntity[]): ThisGameLine[] {
  const root = asRecord(raw) ?? {};
  let roundSource: unknown = raw;
  if (Array.isArray(root.rounds)) roundSource = raw;
  else {
    for (const value of Object.values(root)) {
      const nested = asRecord(value);
      if (nested && Array.isArray(nested.rounds)) {
        roundSource = nested;
        break;
      }
      if (
        Array.isArray(value) &&
        value[0] &&
        asRecord(value[0]) &&
        Array.isArray(asRecord(value[0])?.teams)
      ) {
        roundSource = { rounds: value };
        break;
      }
    }
  }
  const box = asRecord(roundSource) ?? {};
  const rounds = asArray(box.rounds).length ? asArray(box.rounds) : asArray(roundSource);
  const merged = new Map<string, ThisGameLine>();

  for (const round of rounds) {
    const roundRow = asRecord(round);
    if (!roundRow) continue;
    const roundStats =
      asRecord(roundRow.round_stats) ?? asRecord(roundRow.stats) ?? {};
    const mapKey = normalizeMapKey(
      str(roundStats.Map ?? roundStats.map ?? roundRow.map ?? "unknown"),
      pool,
    );
    const winner = str(roundStats.Winner ?? roundStats.winner ?? roundRow.winner);
    const roundCount = pickNum(roundStats, "Rounds", "i18", "rounds");
    const teams = asArray(roundRow.teams);

    for (const team of teams) {
      const teamRow = asRecord(team);
      if (!teamRow) continue;
      const teamKey = str(teamRow.team_id ?? teamRow.faction_id ?? teamRow.id);
      const won = teamWon(teamRow, winner, teamKey);
      const players = asArray(teamRow.players);

      for (const player of players) {
        const row = asRecord(player);
        if (!row) continue;
        const playerId = str(row.player_id ?? row.playerId ?? row.id);
        const nickname = str(row.nickname ?? row.name);
        if (!playerId || !nickname) continue;
        const stats = asRecord(row.player_stats) ?? asRecord(row.stats) ?? row;
        const kills = pickNum(stats, "Kills", "i6", "kills") ?? 0;
        const deaths = pickNum(stats, "Deaths", "i8", "deaths") ?? 0;
        const assists = pickNum(stats, "Assists", "i7", "assists") ?? 0;
        const kd =
          pickNum(stats, "K/D Ratio", "K/D", "c2", "kd") ??
          (deaths > 0 ? kills / deaths : kills);
        const adr = pickNum(
          stats,
          "ADR",
          "Average Damage per Round",
          "Damage / Round",
          "i20",
        );
        if (merged.size === 0) {
          // Phase-0 verification: surface the raw key set once per parse so a
          // live finished match confirms the advanced-stat field spellings.
          console.debug("[fin] player_stats keys", Object.keys(stats).sort());
        }
        const roleStats = parseRoleStats(stats);
        roleStats.rounds = roundCount;
        const prev = merged.get(playerId);
        if (!prev) {
          merged.set(playerId, {
            playerId,
            nickname,
            teamKey,
            kills,
            deaths,
            assists,
            kd,
            adr,
            won,
            mapKey,
            roleStats,
          });
          continue;
        }
        const nextKills = prev.kills + kills;
        const nextDeaths = prev.deaths + deaths;
        merged.set(playerId, {
          ...prev,
          kills: nextKills,
          deaths: nextDeaths,
          assists: prev.assists + assists,
          kd: nextDeaths > 0 ? nextKills / nextDeaths : nextKills,
          adr:
            prev.adr != null && adr != null
              ? (prev.adr + adr) / 2
              : (prev.adr ?? adr),
          won: prev.won || won,
          roleStats: prev.roleStats
            ? mergeRoleStats(prev.roleStats, roleStats)
            : roleStats,
        });
      }
    }
  }

  return [...merged.values()];
}

const thisGameCache = new Map<string, { at: number; lines: ThisGameLine[] }>();

export async function fetchThisGame(
  matchId: string,
  pool: MapEntity[],
  token: string | undefined,
): Promise<ThisGameLine[]> {
  const cached = thisGameCache.get(matchId);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS && cached.lines.length > 0) {
    return cached.lines;
  }
  const ids = [...new Set([matchId, matchId.replace(/^1-/, ""), `1-${matchId.replace(/^1-/, "")}`])];
  const paths = ids.flatMap((id) => [
    `/stats/v1/stats/matches/${id}`,
    `/stats/v1/matches/${id}`,
    `/match/v2/match/${id}/stats`,
    `/stats/v2/matches/${id}`,
    `/stats/v1/stats/time/matches/${id}`,
  ]);
  for (const path of paths) {
    try {
      const raw = await faceitGet(path, token);
      const lines = parseRounds(raw, pool);
      if (lines.length > 0) {
        thisGameCache.set(matchId, { at: now, lines });
        return lines;
      }
    } catch (error) {
      if (error instanceof FaceitApiError && error.status === 404) continue;
      if (error instanceof FaceitApiError && (error.status === 401 || error.status === 403)) {
        throw error;
      }
    }
  }
  return [];
}

export function isMatchFinished(status: string): boolean {
  const value = status.trim().toLowerCase();
  return (
    value.includes("finish") ||
    value.includes("complete") ||
    value === "closed" ||
    value === "over"
  );
}
