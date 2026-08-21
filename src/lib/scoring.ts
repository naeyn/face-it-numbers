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

/** Raw WR, or Bayesian WR shrunk toward 50% using mean games per player. */
export function displayWinRate(
  stat: TeamMapStat,
  adjust: boolean,
): number | null {
  if (stat.games <= 0 || stat.winRate == null) return null;
  if (!adjust) return stat.winRate;
  const { wins, games } = meanSample(stat);
  if (games <= 0) return null;
  return shrinkWinRate(wins, games);
}

/** You minus them. Unknown raw samples sort as 50/50, not 0%. */
export function pickAdvantage(
  you: TeamMapStat,
  them: TeamMapStat,
  adjust: boolean,
): number {
  const yours = displayWinRate(you, adjust) ?? 0.5;
  const theirs = displayWinRate(them, adjust) ?? 0.5;
  return yours - theirs;
}

export function playerDisplayWinRate(
  wins: number,
  games: number,
  raw: number | null,
  adjust: boolean,
): number | null {
  if (games <= 0) return raw;
  if (!adjust) return raw;
  return shrinkWinRate(wins, games);
}
