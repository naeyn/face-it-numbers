import { LABEL_MAP_SAMPLE, LABEL_MIN_SAMPLE, SAMPLE_LIMIT } from "./constants";
import type { GameLabel, HistoryGame, PlayerHistory } from "./types";
import type { ThisGameLine } from "./match-stats";

export function sameMatchId(a: string, b: string): boolean {
  return a.replace(/^1-/, "") === b.replace(/^1-/, "");
}

export function priorGames(
  games: HistoryGame[],
  matchId: string,
  asOf?: number,
): HistoryGame[] {
  const sorted = [...games].sort((a, b) => (b.at || 0) - (a.at || 0));
  const before = sorted.filter((game) => {
    if (game.matchId && sameMatchId(game.matchId, matchId)) return false;
    if (asOf && asOf > 0) return game.at > 0 && game.at < asOf;
    return true;
  });
  return before.slice(0, SAMPLE_LIMIT);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(value: number, sample: number[]): number {
  if (sample.length === 0) return 0.5;
  const below = sample.filter((item) => item < value).length;
  const equal = sample.filter((item) => item === value).length;
  return (below + equal * 0.5) / sample.length;
}

function sampleFor(
  games: HistoryGame[],
  mapKey: string,
): { kds: number[]; mapGames: number; mapWins: number } {
  const usable = games.filter((game) => game.kd != null) as Array<
    HistoryGame & { kd: number }
  >;
  const onMap = usable.filter((game) => game.mapKey === mapKey);
  const mapGames = games.filter((game) => game.mapKey === mapKey).length;
  const mapWins = games.filter((game) => game.mapKey === mapKey && game.won).length;
  const kds =
    onMap.length >= LABEL_MAP_SAMPLE
      ? onMap.map((game) => game.kd)
      : usable.map((game) => game.kd);
  return { kds, mapGames, mapWins };
}

function teamRank(line: ThisGameLine, lines: ThisGameLine[]): { first: boolean; last: boolean } {
  const teammates = lines.filter((item) => item.teamKey === line.teamKey);
  const best = Math.max(...teammates.map((item) => item.kd));
  const worst = Math.min(...teammates.map((item) => item.kd));
  return { first: line.kd >= best, last: line.kd <= worst };
}

export function assignGameLabels(
  matchId: string,
  lines: ThisGameLine[],
  histories: Map<string, PlayerHistory>,
  asOf?: number,
): GameLabel[] {
  if (lines.length === 0) return [];
  const labels: GameLabel[] = [];

  for (const line of lines) {
    const history = histories.get(line.playerId);
    const games = priorGames(history?.games ?? [], matchId, asOf);
    const { kds, mapGames, mapWins } = sampleFor(games, line.mapKey);
    if (kds.length < LABEL_MAP_SAMPLE) continue;

    const avg = mean(kds);
    const pct = percentile(line.kd, kds);
    const streak = games.slice(0, 3).map((game) => game.won);
    const cold = streak.length === 3 && streak.every((won) => !won);
    const rank = teamRank(line, lines);
    const mapWr = mapGames > 0 ? mapWins / mapGames : 0;
    const vs = `${line.kd.toFixed(2)} KD vs ${avg.toFixed(2)} prior`;
    const detail = `${vs} · ${line.won ? "W" : "L"} · ${Math.round(pct * 100)}th pct of prior ${kds.length}`;

    const life = kds.length >= LABEL_MIN_SAMPLE && pct >= 0.9 && line.kd >= avg * 1.22;
    const brick = kds.length >= LABEL_MIN_SAMPLE && pct <= 0.1 && line.kd <= avg * 0.78;
    const cook = pct >= 0.75 && line.kd >= avg * 1.1;
    const off = pct <= 0.25 && line.kd <= avg * 0.9;
    const carry = (life || cook || pct >= 0.68) && rank.first;
    const passenger = line.won && (brick || off || pct <= 0.38) && rank.last;
    const bounce = cold && line.won && (life || cook || pct >= 0.7);
    const tilted = cold && !line.won && (brick || off);
    const merchant = mapGames >= 6 && mapWr >= 0.55 && pct >= 0.6 && !life;
    const tourist =
      mapGames <= 2 && (pct >= 0.85 || pct <= 0.15) && kds.length >= LABEL_MIN_SAMPLE;

    let key: GameLabel["key"] | undefined;
    let text = "";
    let tone: GameLabel["tone"] = "info";
    if (life) {
      key = "lifegame";
      text = "Lifegame";
      tone = "hot";
    } else if (brick) {
      key = "brick";
      text = "Brick";
      tone = "cold";
    } else if (carry) {
      key = "carry";
      text = "Carry";
      tone = "hot";
    } else if (passenger) {
      key = "passenger";
      text = "Passenger";
      tone = "bad";
    } else if (bounce) {
      key = "bounce";
      text = "Bounce back";
      tone = "good";
    } else if (tilted) {
      key = "tilted";
      text = "Tilted";
      tone = "cold";
    } else if (cook) {
      key = "cooking";
      text = "Cooking";
      tone = "good";
    } else if (off) {
      key = "offgame";
      text = "Off game";
      tone = "bad";
    } else if (merchant) {
      key = "merchant";
      text = "Map merchant";
      tone = "info";
    } else if (tourist) {
      key = "tourist";
      text = "Tourist";
      tone = "info";
    }
    if (!key) continue;
    labels.push({
      playerId: line.playerId,
      nickname: line.nickname,
      key,
      text,
      tone,
      detail,
    });
  }

  return labels;
}
