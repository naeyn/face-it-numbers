import type { RoleLabel, RoleLabelKey, RoleStats } from "./types";
import type { ThisGameLine } from "./match-stats";

// Draft thresholds per docs/role-pendants-spec.md — floors stop low-signal
// awards; lobby-relative winners self-calibrate per match.
const MIN_LINES = 8;
const OPENER_ENTRY_RATE = 0.22;
const OPENER_SUCCESS = 0.45;
const AWPER_MIN_KILLS = 7;
const AWPER_KILL_SHARE = 0.35;
const UTILITY_MIN_DAMAGE = 120;
const UTILITY_FLASHED_RATE = 0.5;
const ONETAP_MIN_HS_PCT = 65;
const ONETAP_MIN_KILLS = 15;
const CLOSER_MIN_MVPS = 6;
const PISTOL_MIN_KILLS = 7;
const PISTOL_KILL_SHARE = 0.3;
const SUPPORT_MIN_ASSISTS = 10;
const SUPPORT_MAX_KD = 1.15;

type Line = ThisGameLine & { roleStats: RoleStats };

function perRound(value: number | null, rounds: number | null): number | null {
  if (value == null || rounds == null || rounds <= 0) return null;
  return value / rounds;
}

function hsPct(line: Line): number | null {
  const { headshots, headshotPct } = line.roleStats;
  if (headshots != null && line.kills > 0) return (headshots / line.kills) * 100;
  return headshotPct;
}

function clutchWins(line: Line): number {
  return (line.roleStats.oneV1Wins ?? 0) + (line.roleStats.oneV2Wins ?? 0);
}

function entryRate(line: Line): number | null {
  return perRound(line.roleStats.entryCount, line.roleStats.rounds);
}

// Strict lobby max: a single player holds the highest non-null value.
// Ties or an all-null field award nobody.
function strictMax(lines: Line[], value: (line: Line) => number | null): Line | undefined {
  let best: Line | undefined;
  let bestValue = -Infinity;
  let tied = false;
  for (const line of lines) {
    const v = value(line);
    if (v == null) continue;
    if (v > bestValue) {
      best = line;
      bestValue = v;
      tied = false;
    } else if (v === bestValue) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

function holdsStrictMax(
  line: Line,
  lines: Line[],
  value: (line: Line) => number | null,
): boolean {
  return strictMax(lines, value)?.playerId === line.playerId;
}

type RoleDef = {
  key: RoleLabelKey;
  text: string;
  tone: RoleLabel["tone"];
  // absolute roles can award several players; lobby-relative ones at most one
  absolute: boolean;
  qualify: (line: Line, lines: Line[]) => string | undefined; // detail when awarded
};

const one = (value: number | null): string => (value ?? 0).toFixed(2);

// Precedence order per spec: rare flavor high, career last (Phase 2 roles
// slot into this list when the Leetify phases land).
const ROLE_DEFS: RoleDef[] = [
  {
    key: "humiliation",
    text: "Humiliation",
    tone: "info",
    absolute: true,
    qualify: (line) => {
      const knife = line.roleStats.knifeKills ?? 0;
      const zeus = line.roleStats.zeusKills ?? 0;
      if (knife + zeus >= 2 || (knife >= 1 && line.won)) {
        const parts = [];
        if (knife) parts.push(`${knife} knife`);
        if (zeus) parts.push(`${zeus} zeus`);
        return `${parts.join(", ")} kill${knife + zeus > 1 ? "s" : ""}`;
      }
      return undefined;
    },
  },
  {
    key: "clutcher",
    text: "Clutcher",
    tone: "good",
    absolute: true,
    qualify: (line) => {
      const v1 = line.roleStats.oneV1Wins ?? 0;
      const v2 = line.roleStats.oneV2Wins ?? 0;
      if (v1 + v2 >= 3 || (v1 + v2 >= 2 && v2 >= 1)) {
        return `${v1} 1v1${v1 === 1 ? "" : "s"}, ${v2} 1v2${v2 === 1 ? "" : "s"} won`;
      }
      return undefined;
    },
  },
  {
    key: "highlight",
    text: "Highlight reel",
    tone: "good",
    absolute: true,
    qualify: (line) => {
      const triple = line.roleStats.tripleKills ?? 0;
      const quadro = line.roleStats.quadroKills ?? 0;
      const penta = line.roleStats.pentaKills ?? 0;
      if (penta >= 1 || quadro >= 2 || triple >= 4) {
        const parts = [];
        if (penta) parts.push(`${penta} ace${penta > 1 ? "s" : ""}`);
        if (quadro) parts.push(`${quadro} 4k`);
        if (triple) parts.push(`${triple} 3k`);
        return parts.join(", ");
      }
      return undefined;
    },
  },
  {
    key: "opener",
    text: "Opener",
    tone: "good",
    absolute: false,
    qualify: (line, lines) => {
      const rate = entryRate(line);
      const count = line.roleStats.entryCount;
      const wins = line.roleStats.entryWins;
      if (rate == null || count == null || wins == null || count <= 0) return undefined;
      const success = wins / count;
      if (rate >= OPENER_ENTRY_RATE && success >= OPENER_SUCCESS && holdsStrictMax(line, lines, entryRate)) {
        return `${one(rate)} entry attempts/round (${count} att, ${wins} won) · most in lobby`;
      }
      return undefined;
    },
  },
  {
    key: "awper",
    text: "AWPer",
    tone: "info",
    absolute: false,
    qualify: (line, lines) => {
      const sniper = line.roleStats.sniperKills;
      if (sniper == null || sniper < AWPER_MIN_KILLS || line.kills <= 0) return undefined;
      if (sniper / line.kills >= AWPER_KILL_SHARE && holdsStrictMax(line, lines, (l) => l.roleStats.sniperKills)) {
        return `${sniper} sniper kills (${Math.round((sniper / line.kills) * 100)}% of kills) · most in lobby`;
      }
      return undefined;
    },
  },
  {
    key: "onetapper",
    text: "One-tapper",
    tone: "good",
    absolute: false,
    qualify: (line, lines) => {
      const pct = hsPct(line);
      if (pct == null || pct < ONETAP_MIN_HS_PCT || line.kills < ONETAP_MIN_KILLS) return undefined;
      if (holdsStrictMax(line, lines, hsPct)) {
        return `${Math.round(pct)}% headshots on ${line.kills} kills · highest in lobby`;
      }
      return undefined;
    },
  },
  {
    key: "closer",
    text: "Closer",
    tone: "good",
    absolute: false,
    qualify: (line, lines) => {
      const mvps = line.roleStats.mvps;
      if (mvps == null || mvps < CLOSER_MIN_MVPS || clutchWins(line) < 1) return undefined;
      if (!holdsStrictMax(line, lines, (l) => l.roleStats.mvps)) return undefined;
      if (holdsStrictMax(line, lines, entryRate)) return undefined; // that's an opener
      return `${mvps} MVPs, ${clutchWins(line)} clutch${clutchWins(line) > 1 ? "es" : ""} won · most MVPs in lobby`;
    },
  },
  {
    key: "spacetaker",
    text: "Space taker",
    tone: "good",
    absolute: false,
    qualify: (line, lines) => {
      const rate = entryRate(line);
      const count = line.roleStats.entryCount;
      const wins = line.roleStats.entryWins;
      if (rate == null || count == null || wins == null || count <= 0) return undefined;
      const success = wins / count;
      // the aggressive lobby-max entry player who fell through Opener
      if (rate >= OPENER_ENTRY_RATE && success < OPENER_SUCCESS && holdsStrictMax(line, lines, entryRate)) {
        return `${one(rate)} entry attempts/round (${count} att) · most in lobby, takes the map on`;
      }
      return undefined;
    },
  },
  {
    key: "utilityking",
    text: "Utility king",
    tone: "good",
    absolute: false,
    qualify: (line, lines) => {
      const utilDmg = line.roleStats.utilityDamage;
      const utilRate = perRound(utilDmg, line.roleStats.rounds);
      const flashedRate = perRound(line.roleStats.enemiesFlashed, line.roleStats.rounds);
      if (utilDmg == null || utilRate == null || flashedRate == null) return undefined;
      if (
        utilDmg >= UTILITY_MIN_DAMAGE &&
        flashedRate >= UTILITY_FLASHED_RATE &&
        holdsStrictMax(line, lines, (l) => perRound(l.roleStats.utilityDamage, l.roleStats.rounds))
      ) {
        return `${Math.round(utilDmg)} utility damage, ${line.roleStats.enemiesFlashed} enemies flashed · most in lobby`;
      }
      return undefined;
    },
  },
  {
    key: "pistoldemon",
    text: "Pistol demon",
    tone: "info",
    absolute: true,
    qualify: (line) => {
      const pistol = line.roleStats.pistolKills;
      if (pistol == null || pistol < PISTOL_MIN_KILLS || line.kills <= 0) return undefined;
      if (pistol / line.kills >= PISTOL_KILL_SHARE) {
        return `${pistol} pistol kills (${Math.round((pistol / line.kills) * 100)}% of kills)`;
      }
      return undefined;
    },
  },
  {
    key: "damagedealer",
    text: "Damage dealer",
    tone: "info",
    absolute: false,
    qualify: (line, lines) => {
      if (line.adr == null) return undefined;
      if (!holdsStrictMax(line, lines, (l) => l.adr)) return undefined;
      if (holdsStrictMax(line, lines, (l) => l.kills)) return undefined; // just the top fragger
      return `${Math.round(line.adr)} ADR · highest in lobby without most kills`;
    },
  },
  {
    key: "support",
    text: "Support",
    tone: "info",
    absolute: false,
    qualify: (line, lines) => {
      const ratio = line.assists / Math.max(line.kills, 1);
      if (line.assists < SUPPORT_MIN_ASSISTS || line.kd >= SUPPORT_MAX_KD) return undefined;
      if (holdsStrictMax(line, lines, (l) => l.assists / Math.max(l.kills, 1))) {
        return `${line.assists} assists (${one(ratio)} per kill) · highest ratio in lobby`;
      }
      return undefined;
    },
  },
];

// Banter (negative-tone) role keys — gated by the banterLabels sub-toggle.
// Phase 1 ships none; the Leetify phase adds baiter/teamflasher here.
export const BANTER_ROLE_KEYS: ReadonlySet<string> = new Set<string>([]);

export function assignRoleLabels(lines: ThisGameLine[]): RoleLabel[] {
  const usable = lines.filter((line): line is Line => line.roleStats != null);
  if (usable.length < MIN_LINES) return [];
  const roles: RoleLabel[] = [];
  const taken = new Set<string>();

  for (const def of ROLE_DEFS) {
    for (const line of usable) {
      if (taken.has(line.playerId)) continue;
      const detail = def.qualify(line, usable);
      if (!detail) continue;
      roles.push({
        playerId: line.playerId,
        nickname: line.nickname,
        key: def.key,
        text: def.text,
        tone: def.tone,
        detail,
      });
      taken.add(line.playerId);
      if (!def.absolute) break; // lobby-relative roles award at most once
    }
  }

  return roles;
}
