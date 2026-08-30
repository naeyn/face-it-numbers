import { pickAdvantage } from "./scoring";
import type { SmartSummary, TeamMapStat } from "./types";

/** A win-rate gap of ±0.5 maps to ±100. Tune the feel here and nowhere else. */
export const SCORE_SCALE = 200;

/** A per-map calibration correction may nudge the score, never dominate it. */
export const CALIBRATION_CAP = 0.15;

/**
 * How much this map beats or trails your own baseline, in win-rate units.
 *
 * `smart.biasGlobal` is how far your results sit from what the numbers
 * predicted *overall* — a constant. It never mattered while calibration only
 * sorted maps (a constant shifts every map equally), but the score is
 * displayed, and a player on a rough run would otherwise see every map pegged
 * at -100. Only the per-map deviation carries map-specific information, so
 * only that is applied.
 */
export function calibrationEdge(mapKey: string, smart?: SmartSummary): number {
  if (!smart?.ready) return 0;
  const forMap = smart.bias[mapKey];
  if (forMap == null) return 0;
  const deviation = forMap - smart.biasGlobal;
  return Math.max(-CALIBRATION_CAP, Math.min(CALIBRATION_CAP, deviation));
}

/**
 * Signed edge for one map, in win-rate units: the shrink-adjusted gap between
 * the two rosters, plus whatever correction our own finished lobbies have
 * earned on this map specifically. This — not a raw win rate — is what the
 * panel displays, sorts by and badges from, so all four finally agree.
 */
export function mapEdge(
  you: TeamMapStat,
  them: TeamMapStat,
  mapKey: string,
  smart?: SmartSummary,
): number {
  return pickAdvantage(you, them) + calibrationEdge(mapKey, smart);
}

/** The same edge as the number we show: a clamped integer in -100..100. */
export function mapScore(
  you: TeamMapStat,
  them: TeamMapStat,
  mapKey: string,
  smart?: SmartSummary,
): number {
  return scoreFromEdge(mapEdge(you, them, mapKey, smart));
}

export function scoreFromEdge(edge: number): number {
  return Math.max(-100, Math.min(100, Math.round(edge * SCORE_SCALE)));
}

/** "+26" / "−13" / "0" — never a percent sign. */
export function formatScore(score: number): string {
  if (score > 0) return `+${score}`;
  if (score < 0) return `−${Math.abs(score)}`;
  return "0";
}
