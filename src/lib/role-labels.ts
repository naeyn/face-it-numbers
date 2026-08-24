import type { HistoryGame, RoleLabel, RoleLabelKey } from "./types";

// Pre-match role pendants: playstyle tendencies read from each player's
// recent history (last ~30 games), shown from the lobby onward as intel.
// Lobby-relative (strict best among the 10 players) with absolute floors so
// low-signal lobbies award nothing. Independent of the map-specific brief
// tags. Roles that need advanced per-match stats (entry, sniper, utility,
// clutches — absent from the history endpoint) await the backfill design in
// docs/role-pendants-spec.md.

const MIN_GAMES = 8;
const MIN_PLAYERS = 6;
const ONETAP_MIN_HS = 0.55;
const ONETAP_MIN_KILLS = 120;
const CLOSER_MIN_MVP_PER_ROUND = 0.12;
const HIGHLIGHT_MIN_MULTI_PER_GAME = 1.0;
const DAMAGE_MIN_ADR = 85;
const SUPPORT_MIN_ASSIST_RATIO = 0.42;
const SUPPORT_MAX_KD = 1.1;

export type RolePlayerHistory = {
  playerId: string;
  nickname: string;
  games: HistoryGame[];
};

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
  const rounds = sum((g) => g.rounds);
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
    rounds,
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

function strictMax(
  players: Tendency[],
  value: (player: Tendency) => number | null,
): Tendency | undefined {
  let best: Tendency | undefined;
  let bestValue = -Infinity;
  let tied = false;
  for (const player of players) {
    const v = value(player);
    if (v == null) continue;
    if (v > bestValue) {
      best = player;
      bestValue = v;
      tied = false;
    } else if (v === bestValue) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

function holdsStrictMax(
  player: Tendency,
  players: Tendency[],
  value: (player: Tendency) => number | null,
): boolean {
  return strictMax(players, value)?.playerId === player.playerId;
}

type RoleDef = {
  key: RoleLabelKey;
  text: string;
  tone: RoleLabel["tone"];
  qualify: (player: Tendency, players: Tendency[]) => string | undefined;
};

// Precedence: rarest signal first; every role is lobby-relative, one winner.
const ROLE_DEFS: RoleDef[] = [
  {
    key: "onetapper",
    text: "One-tapper",
    tone: "good",
    qualify: (p, all) => {
      if (p.hsPct == null || p.hsPct < ONETAP_MIN_HS || p.kills < ONETAP_MIN_KILLS)
        return undefined;
      if (!holdsStrictMax(p, all, (t) => t.hsPct)) return undefined;
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
      if (!holdsStrictMax(p, all, (t) => (t.rounds > 0 ? t.mvps / t.rounds : null)))
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
      if (!holdsStrictMax(p, all, (t) => t.multi / t.n)) return undefined;
      return `${p.multi} rounds with 3+ kills in their last ${p.n} games — most in this lobby`;
    },
  },
  {
    key: "damagedealer",
    text: "Damage dealer",
    tone: "info",
    qualify: (p, all) => {
      if (p.adr == null || p.adr < DAMAGE_MIN_ADR) return undefined;
      if (!holdsStrictMax(p, all, (t) => t.adr)) return undefined;
      if (holdsStrictMax(p, all, (t) => t.kd)) return undefined; // just the best player
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
      if (!holdsStrictMax(p, all, (t) => (t.kills > 0 ? t.assists / t.kills : null)))
        return undefined;
      return `${ratio.toFixed(2)} assists per kill over their last ${p.n} games — highest ratio in this lobby`;
    },
  },
];

// Banter (negative-tone) role keys — gated by the banterLabels sub-toggle.
// Empty until the Leetify phase adds baiter/teamflasher.
export const BANTER_ROLE_KEYS: ReadonlySet<string> = new Set<string>([]);

export function assignRoleLabels(players: RolePlayerHistory[]): RoleLabel[] {
  const tendencies = players
    .map(tendencyFor)
    .filter((t): t is Tendency => t != null);
  // Lobby-relative claims need most of the lobby to actually have history.
  if (tendencies.length < MIN_PLAYERS) return [];
  const roles: RoleLabel[] = [];
  const taken = new Set<string>();

  for (const def of ROLE_DEFS) {
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
      });
      taken.add(player.playerId);
      break; // lobby-relative: one winner per role
    }
  }

  return roles;
}
