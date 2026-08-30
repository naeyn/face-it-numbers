import type { TeamMapStat } from "./types";

/** Phantom games at 50% — about a quarter of a last-30 sample. */
export const SHRINK_PRIOR = 8;

export function shrinkWinRate(
  wins: number,
  games: number,
  prior = SHRINK_PRIOR,
): number {
  return (wins + prior * 0.5) / (games + prior);
}

function meanSample(stat: TeamMapStat): { wins: number; games: number } {
  const n = Math.max(stat.players.length, 1);
  return { wins: stat.wins / n, games: stat.games / n };
}

/**
 * Bayesian win rate shrunk toward 50% using mean games per player. This is a
 * score ingredient, never a displayed win rate — anything the user reads as a
 * "win rate" comes straight off `stat.winRate`.
 */
export function displayWinRate(stat: TeamMapStat): number | null {
  if (stat.games <= 0 || stat.winRate == null) return null;
  const { wins, games } = meanSample(stat);
  if (games <= 0) return null;
  return shrinkWinRate(wins, games);
}

/** You minus them, shrunk. Unknown samples sort as 50/50, not 0%. */
export function pickAdvantage(you: TeamMapStat, them: TeamMapStat): number {
  const yours = displayWinRate(you) ?? 0.5;
  const theirs = displayWinRate(them) ?? 0.5;
  return yours - theirs;
}
