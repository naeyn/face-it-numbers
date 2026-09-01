import { OUTLIER_GAP, OUTLIER_MIN_GAMES, STACK_MIN_PLAYERS, THIN_MEAN_GAMES } from "./constants";
import { mapEdge } from "./score";
import { sameMatchId } from "./game-labels";
import type { HistoryGame, PlayerMapStat, SmartSummary, TeamMapStat } from "./types";

export type ChartBadge = "ban" | "perm-you" | "perm-them" | "thin";

export function meanGames(stat: TeamMapStat): number {
  const n = Math.max(stat.players.length, 1);
  return stat.games / n;
}

export function isThin(stat: TeamMapStat): boolean {
  return stat.games < THIN_MEAN_GAMES;
}

export function stackOverlap(
  players: Array<{ nickname: string; matchIds: string[] }>,
): { count: number; names: string[] } {
  const appearances = new Map<string, Set<string>>();
  for (const player of players) {
    for (const id of new Set(player.matchIds)) {
      const set = appearances.get(id) ?? new Set<string>();
      set.add(player.nickname);
      appearances.set(id, set);
    }
  }

  const stacked = [...appearances.values()].filter(
    (set) => set.size >= STACK_MIN_PLAYERS,
  );
  if (stacked.length === 0) return { count: 0, names: [] };

  const freq = new Map<string, number>();
  for (const set of stacked) {
    for (const name of set) freq.set(name, (freq.get(name) ?? 0) + 1);
  }

  const threshold = Math.ceil(stacked.length / 2);
  const names = [...freq.entries()]
    .filter(([, games]) => games >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);

  return { count: stacked.length, names };
}

export function averageEloDelta(
  deltas: Array<number | null | undefined>,
): number | null {
  const values = deltas.filter((value): value is number => typeof value === "number");
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function formatElo(delta: number | null): string {
  if (delta == null) return "—";
  const rounded = Math.round(delta);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export function formatForm(recent: boolean[]): string {
  if (recent.length === 0) return "";
  return recent.map((win) => (win ? "W" : "L")).join("");
}

export type Streak = { len: number; won: boolean };

/**
 * The player's current unbroken run across ALL maps, newest game first — the
 * one thing the per-map form dots cannot show. `exclude` drops the room's own
 * match, which `historyGames` still contains once the match is over (unlike
 * the label path, it is never rebuilt as-of the match).
 */
export function currentStreak(
  games: HistoryGame[],
  exclude?: string,
): Streak | undefined {
  const sorted = [...games].sort((a, b) => (b.at || 0) - (a.at || 0));
  const usable = exclude
    ? sorted.filter((game) => !(game.matchId && sameMatchId(game.matchId, exclude)))
    : sorted;
  if (usable.length === 0) return undefined;
  const won = usable[0].won;
  let len = 0;
  for (const game of usable) {
    if (game.won !== won) break;
    len += 1;
  }
  return { len, won };
}

export function findOutlier(stat: TeamMapStat): PlayerMapStat | undefined {
  const qualified = stat.players.filter(
    (player) => player.games >= OUTLIER_MIN_GAMES && player.winRate != null,
  );
  if (qualified.length < 2 || stat.winRate == null) return undefined;
  let worst = qualified[0];
  for (const player of qualified) {
    if ((player.winRate ?? 1) < (worst.winRate ?? 1)) worst = player;
  }
  if ((stat.winRate ?? 0) - (worst.winRate ?? 0) < OUTLIER_GAP) return undefined;
  return worst;
}

export function suggestBanPick(
  remaining: Array<{
    mapKey: string;
    displayName: string;
    you: TeamMapStat;
    them: TeamMapStat;
  }>,
  smart?: SmartSummary,
): { ban?: string; pick?: string } {
  if (remaining.length === 0) return {};
  const scored = remaining.map((row) => ({
    name: row.displayName,
    score: mapEdge(row.you, row.them, row.mapKey, smart),
  }));
  scored.sort((a, b) => b.score - a.score);
  const pick = scored[0]?.name;
  const ban = scored[scored.length - 1]?.name;
  if (pick && ban && pick === ban) return { pick };
  return { pick, ban };
}

export function badgeForMap(
  row: { mapKey: string; you: TeamMapStat; them: TeamMapStat; dropped: boolean },
  remaining: Array<{ mapKey: string; you: TeamMapStat; them: TeamMapStat }>,
  smart?: SmartSummary,
): ChartBadge | undefined {
  if (row.dropped) {
    return isThin(row.you) || isThin(row.them) ? "thin" : undefined;
  }
  if (remaining.length === 0) return undefined;

  const scores = remaining.map((item) => ({
    mapKey: item.mapKey,
    score: mapEdge(item.you, item.them, item.mapKey, smart),
    youThin: isThin(item.you),
    themThin: isThin(item.them),
    youWr: item.you.winRate ?? 0,
    themWr: item.them.winRate ?? 0,
    youGames: meanGames(item.you),
    themGames: meanGames(item.them),
  }));

  const worst = [...scores].sort((a, b) => a.score - b.score)[0];
  const best = [...scores].sort((a, b) => b.score - a.score)[0];
  const themPerm = [...scores]
    .filter((item) => !item.themThin)
    .sort((a, b) => b.themWr - a.themWr || b.themGames - a.themGames)[0];
  const youPerm = [...scores]
    .filter((item) => !item.youThin)
    .sort((a, b) => b.youWr - a.youWr || b.youGames - a.youGames)[0];

  if (worst && row.mapKey === worst.mapKey && worst.score < 0) return "ban";
  if (themPerm && row.mapKey === themPerm.mapKey && themPerm.themWr >= 0.55) {
    return "perm-them";
  }
  if (youPerm && row.mapKey === youPerm.mapKey && best?.mapKey === row.mapKey) {
    return "perm-you";
  }
  if (isThin(row.you) || isThin(row.them)) return "thin";
  return undefined;
}
