import type { HistoryGame, RoleLabel, RoleLabelKey } from "./types";
import type { LeetifyProfile } from "./leetify";

// Pre-match role pendants: playstyle intel shown from the lobby onward.
// Two sources, one precedence list, one badge per player:
//  1. Leetify career profiles (actual playstyle data: opening duels, trades,
//     aim mechanics) — best-effort, ~half a lobby is tracked.
//  2. Faceit history tendencies (last ~30 games) as fallback coverage.
// Lobby-relative (strict best among available players) with absolute floors.
// Independent of the map-specific brief tags.

const MIN_GAMES = 8;
const MIN_PLAYERS = 6;
const MIN_PROFILES = 4;

// History floors
const ONETAP_MIN_HS = 0.55;
const ONETAP_MIN_KILLS = 120;
const CLOSER_MIN_MVP_PER_ROUND = 0.12;
const HIGHLIGHT_MIN_MULTI_PER_GAME = 1.0;
const DAMAGE_MIN_ADR = 85;
const SUPPORT_MIN_ASSIST_RATIO = 0.42;
const SUPPORT_MAX_KD = 1.1;

// Career floors (Leetify units; percentages normalized to 0-100)
const ENTRY_MIN_DUEL_SUCCESS = 48;
const TRADER_MIN_SUCCESS = 55;
const TRADER_MIN_OPPS_PER_ROUND = 0.25;
const FLASH_MIN_HIT_PER_FLASH = 0.7;
const CROSSHAIR_MAX_PREAIM = 10;
const REFLEX_MAX_MS = 550;
const SPRAY_MIN_ACCURACY = 25;
const SIDED_MIN_GAP = 0.05;

export type RolePlayerHistory = {
  playerId: string;
  nickname: string;
  games: HistoryGame[];
};

// Banter (negative-tone) role keys — gated by the banterLabels sub-toggle.
// Empty until the Leetify per-match phase adds baiter/teamflasher.
export const BANTER_ROLE_KEYS: ReadonlySet<string> = new Set<string>([]);

function pct(value: number | null): number | null {
  if (value == null) return null;
  return value <= 1.5 ? value * 100 : value;
}

function strictBest<T extends { playerId: string }>(
  items: T[],
  value: (item: T) => number | null,
  lowerIsBetter = false,
): T | undefined {
  let best: T | undefined;
  let bestValue = lowerIsBetter ? Infinity : -Infinity;
  let tied = false;
  for (const item of items) {
    const v = value(item);
    if (v == null) continue;
    const better = lowerIsBetter ? v < bestValue : v > bestValue;
    if (better) {
      best = item;
      bestValue = v;
      tied = false;
    } else if (v === bestValue) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

function holdsBest<T extends { playerId: string }>(
  item: T,
  items: T[],
  value: (item: T) => number | null,
  lowerIsBetter = false,
): boolean {
  return strictBest(items, value, lowerIsBetter)?.playerId === item.playerId;
}

// ---- Career roles from Leetify profiles ----

export type CareerPlayer = {
  playerId: string;
  nickname: string;
  profile: LeetifyProfile;
};

export type CareerDef = {
  key: RoleLabelKey;
  text: string | ((player: CareerPlayer) => string);
  tone: RoleLabel["tone"];
  qualify: (player: CareerPlayer, all: CareerPlayer[], tracked: number) => string | undefined;
};

function bestOpeningSuccess(profile: LeetifyProfile): number | null {
  const ct = pct(profile.openingDuelSuccessCt);
  const t = pct(profile.openingDuelSuccessT);
  if (ct == null) return t;
  if (t == null) return ct;
  return Math.max(ct, t);
}

export const CAREER_DEFS: CareerDef[] = [
  {
    key: "opener",
    text: "Opener",
    tone: "good",
    qualify: (p, all, tracked) => {
      const success = bestOpeningSuccess(p.profile);
      if (success == null || success < ENTRY_MIN_DUEL_SUCCESS) return undefined;
      if (!holdsBest(p, all, (c) => c.profile.openingRating)) return undefined;
      return `Biggest opening-duel impact of the ${tracked} Leetify-tracked players here, winning ${Math.round(success)}% of first duels`;
    },
  },
  {
    key: "trader",
    text: "Trade machine",
    tone: "good",
    qualify: (p, all, tracked) => {
      const success = pct(p.profile.tradeSuccessPct);
      const opps = p.profile.tradeOppsPerRound;
      if (success == null || success < TRADER_MIN_SUCCESS) return undefined;
      if (opps == null || opps < TRADER_MIN_OPPS_PER_ROUND) return undefined;
      if (!holdsBest(p, all, (c) => pct(c.profile.tradeSuccessPct))) return undefined;
      return `Converts ${Math.round(success)}% of trade chances — best of the ${tracked} Leetify-tracked players here`;
    },
  },
  {
    key: "crosshair",
    text: "Crosshair placement",
    tone: "good",
    qualify: (p, all, tracked) => {
      const preaim = p.profile.preaim;
      if (preaim == null || preaim > CROSSHAIR_MAX_PREAIM) return undefined;
      if (!holdsBest(p, all, (c) => c.profile.preaim, true)) return undefined;
      return `Crosshair only ${preaim.toFixed(1)}° off target on average — best of the ${tracked} Leetify-tracked players here`;
    },
  },
  {
    key: "reflexes",
    text: "Instant reflexes",
    tone: "info",
    qualify: (p, all, tracked) => {
      const ms = p.profile.reactionTimeMs;
      if (ms == null || ms > REFLEX_MAX_MS) return undefined;
      if (!holdsBest(p, all, (c) => c.profile.reactionTimeMs, true)) return undefined;
      return `${Math.round(ms)} ms average reaction time — fastest of the ${tracked} Leetify-tracked players here`;
    },
  },
  {
    key: "spray",
    text: "Spray control",
    tone: "good",
    qualify: (p, all, tracked) => {
      const accuracy = pct(p.profile.sprayAccuracy);
      if (accuracy == null || accuracy < SPRAY_MIN_ACCURACY) return undefined;
      if (!holdsBest(p, all, (c) => pct(c.profile.sprayAccuracy))) return undefined;
      return `${Math.round(accuracy)}% spray accuracy — best of the ${tracked} Leetify-tracked players here`;
    },
  },
  {
    key: "flashsupport",
    text: "Flash support",
    tone: "info",
    qualify: (p, all, tracked) => {
      const perFlash = p.profile.flashHitFoePerFlash;
      if (perFlash == null || perFlash < FLASH_MIN_HIT_PER_FLASH) return undefined;
      if (!holdsBest(p, all, (c) => c.profile.flashHitFoePerFlash)) return undefined;
      return `Blinds ${perFlash.toFixed(1)} enemies per flashbang — best of the ${tracked} Leetify-tracked players here`;
    },
  },
  {
    key: "sided",
    text: (p) =>
      (p.profile.ctRating ?? 0) >= (p.profile.tRating ?? 0) ? "CT-sided" : "T-sided",
    tone: "info",
    qualify: (p, all) => {
      const ct = p.profile.ctRating;
      const t = p.profile.tRating;
      if (ct == null || t == null) return undefined;
      const gap = Math.abs(ct - t);
      if (gap < SIDED_MIN_GAP) return undefined;
      if (!holdsBest(p, all, (c) =>
        c.profile.ctRating != null && c.profile.tRating != null
          ? Math.abs(c.profile.ctRating - c.profile.tRating)
          : null,
      ))
        return undefined;
      const side = ct >= t ? "CT" : "T";
      return `Clearly stronger on the ${side} side — the biggest side split among Leetify-tracked players here`;
    },
  },
];

// ---- History tendency roles (fallback coverage) ----

type Tendency = {
  playerId: string;
  nickname: string;
  n: number;
  kills: number;
  deaths: number;
  assists: number;
  rounds: number;
  mvps: number;
  multi: number; // 3k + 4k + 5k rounds
  hsPct: number | null; // kill-weighted, 0..1
  adr: number | null;
  kd: number | null;
};

function tendencyFor(player: RolePlayerHistory): Tendency | undefined {
  const usable = player.games.filter(
    (game) => game.kills != null && game.rounds != null && game.rounds > 0,
  );
  if (usable.length < MIN_GAMES) return undefined;
  const sum = (pick: (game: HistoryGame) => number | null): number =>
    usable.reduce((total, game) => total + (pick(game) ?? 0), 0);
  const kills = sum((g) => g.kills);
  const deaths = sum((g) => g.deaths);
  const hsKillsWeighted = usable.reduce(
    (total, game) =>
      total + (game.hsPct != null && game.kills != null ? game.hsPct * game.kills : 0),
    0,
  );
  const hsKillBase = usable.reduce(
    (total, game) => total + (game.hsPct != null && game.kills != null ? game.kills : 0),
    0,
  );
  const adrGames = usable.filter((game) => game.adr != null);
  return {
    playerId: player.playerId,
    nickname: player.nickname,
    n: usable.length,
    kills,
    deaths,
    assists: sum((g) => g.assists),
    rounds: sum((g) => g.rounds),
    mvps: sum((g) => g.mvps),
    multi: sum((g) => g.tripleKills) + sum((g) => g.quadroKills) + sum((g) => g.pentaKills),
    hsPct: hsKillBase > 0 ? hsKillsWeighted / hsKillBase : null,
    adr:
      adrGames.length > 0
        ? adrGames.reduce((total, game) => total + (game.adr ?? 0), 0) / adrGames.length
        : null,
    kd: deaths > 0 ? kills / deaths : null,
  };
}

export type HistoryDef = {
  key: RoleLabelKey;
  text: string;
  tone: RoleLabel["tone"];
  qualify: (player: Tendency, players: Tendency[]) => string | undefined;
};

export const HISTORY_DEFS: HistoryDef[] = [
  {
    key: "onetapper",
    text: "One-tapper",
    tone: "good",
    qualify: (p, all) => {
      if (p.hsPct == null || p.hsPct < ONETAP_MIN_HS || p.kills < ONETAP_MIN_KILLS)
        return undefined;
      if (!holdsBest(p, all, (t) => t.hsPct)) return undefined;
      return `${Math.round(p.hsPct * 100)}% headshots across ${p.kills} kills in their last ${p.n} games — highest rate in this lobby`;
    },
  },
  {
    key: "closer",
    text: "Closer",
    tone: "good",
    qualify: (p, all) => {
      const rate = p.rounds > 0 ? p.mvps / p.rounds : null;
      if (rate == null || rate < CLOSER_MIN_MVP_PER_ROUND) return undefined;
      if (!holdsBest(p, all, (t) => (t.rounds > 0 ? t.mvps / t.rounds : null)))
        return undefined;
      return `${p.mvps} round-MVP stars over their last ${p.n} games (${rate.toFixed(2)}/round) — most in this lobby`;
    },
  },
  {
    key: "highlight",
    text: "Highlight reel",
    tone: "good",
    qualify: (p, all) => {
      const rate = p.multi / p.n;
      if (rate < HIGHLIGHT_MIN_MULTI_PER_GAME) return undefined;
      if (!holdsBest(p, all, (t) => t.multi / t.n)) return undefined;
      return `${p.multi} rounds with 3+ kills in their last ${p.n} games — most in this lobby`;
    },
  },
  {
    key: "damagedealer",
    text: "Damage dealer",
    tone: "info",
    qualify: (p, all) => {
      if (p.adr == null || p.adr < DAMAGE_MIN_ADR) return undefined;
      if (!holdsBest(p, all, (t) => t.adr)) return undefined;
      if (holdsBest(p, all, (t) => t.kd)) return undefined; // just the best player
      return `${Math.round(p.adr)} damage per round over their last ${p.n} games — highest in this lobby without the top K/D`;
    },
  },
  {
    key: "support",
    text: "Support",
    tone: "info",
    qualify: (p, all) => {
      const ratio = p.kills > 0 ? p.assists / p.kills : null;
      if (ratio == null || ratio < SUPPORT_MIN_ASSIST_RATIO) return undefined;
      if (p.kd == null || p.kd >= SUPPORT_MAX_KD) return undefined;
      if (!holdsBest(p, all, (t) => (t.kills > 0 ? t.assists / t.kills : null)))
        return undefined;
      return `${ratio.toFixed(2)} assists per kill over their last ${p.n} games — highest ratio in this lobby`;
    },
  },
];

export function assignRoleLabels(
  players: RolePlayerHistory[],
  leetifyById?: Map<string, LeetifyProfile>,
): RoleLabel[] {
  const roles: RoleLabel[] = [];
  const taken = new Set<string>();

  // Career roles first — actual playstyle data beats statistical inference.
  const career: CareerPlayer[] = players.flatMap((player) => {
    const profile = leetifyById?.get(player.playerId);
    return profile ? [{ playerId: player.playerId, nickname: player.nickname, profile }] : [];
  });
  if (career.length >= MIN_PROFILES) {
    for (const def of CAREER_DEFS) {
      for (const player of career) {
        if (taken.has(player.playerId)) continue;
        const detail = def.qualify(player, career, career.length);
        if (!detail) continue;
        roles.push({
          playerId: player.playerId,
          nickname: player.nickname,
          key: def.key,
          text: typeof def.text === "function" ? def.text(player) : def.text,
          tone: def.tone,
          detail,
          source: "leetify",
        });
        taken.add(player.playerId);
        break; // one winner per role
      }
    }
  }

  // History tendencies fill remaining players.
  const tendencies = players
    .map(tendencyFor)
    .filter((t): t is Tendency => t != null);
  if (tendencies.length >= MIN_PLAYERS) {
    for (const def of HISTORY_DEFS) {
      for (const player of tendencies) {
        if (taken.has(player.playerId)) continue;
        const detail = def.qualify(player, tendencies);
        if (!detail) continue;
        roles.push({
          playerId: player.playerId,
          nickname: player.nickname,
          key: def.key,
          text: def.text,
          tone: def.tone,
          detail,
          source: "history",
        });
        taken.add(player.playerId);
        break;
      }
    }
  }

  return roles;
}
