import { LABEL_MIN_SAMPLE, THIN_MEAN_GAMES } from "./constants";
import { displayWinRate } from "./scoring";
import { stackOverlap } from "./insights";
import type {
  HistoryGame,
  LobbyStats,
  PlayerMapStat,
  TeamMapStat,
} from "./types";

export type BriefTone = "hot" | "good" | "bad" | "cold" | "info";

export const TAG_HINTS: Record<string, string> = {
  Fragger: "Highest K/D on this map in their last 30 (min 5 games)",
  Merchant: "Plays this map a lot and wins more than half",
  Tourist: "0–1 last-30 games on this map",
  Hot: "Won their last 4 on this map",
  Cold: "Lost their last 4 on this map",
};

export type BriefPlayer = {
  playerId: string;
  nickname: string;
  games: number;
  winRate: number | null;
  kd: number | null;
  adr: number | null;
  recent: boolean[];
  tag: string | undefined;
  tagTone: BriefTone;
};

export type TeamBrief = {
  games: number;
  winRate: number | null;
  kd: number | null;
  adr: number | null;
  stack: number;
  stackNames: string[];
  thin: boolean;
  form: "rolling" | "leaking" | undefined;
  players: BriefPlayer[];
};

export type MatchBriefing = {
  mapKey: string;
  displayName: string;
  headline: string;
  lean: "you" | "them" | "even";
  gap: number;
  you: TeamBrief;
  them: TeamBrief;
};

const FRAG_GAMES = 5;
const STREAK = 4;
const MERCHANT_PLAY = 0.22;
const EDGE = 0.05;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function pickedMapKeys(stats: LobbyStats): string[] {
  const keys: string[] = [];
  for (const row of stats.you.maps) {
    if (row.picked && !keys.includes(row.mapKey)) keys.push(row.mapKey);
  }
  for (const row of stats.them.maps) {
    if (row.picked && !keys.includes(row.mapKey)) keys.push(row.mapKey);
  }
  return keys;
}

export function vetoComplete(stats: LobbyStats): boolean {
  if (pickedMapKeys(stats).length > 0) return true;
  const status = (stats.status ?? "").toLowerCase();
  if (/vot|config|created|sched|check/.test(status)) return false;
  return /ready|ongoing|subst|live|finish/.test(status);
}

function gamesFor(
  stats: LobbyStats,
  playerId: string,
  mapKey: string,
): HistoryGame[] {
  const row = stats.historyGames.find((item) => item.playerId === playerId);
  return (row?.games ?? []).filter((game) => game.mapKey === mapKey);
}

function avgOn(games: HistoryGame[], key: "kd" | "adr"): number | null {
  return mean(
    games
      .map((game) => game[key])
      .filter((value): value is number => value != null),
  );
}

function mapStack(
  stats: LobbyStats,
  players: { player_id: string; nickname: string }[],
  mapKey: string,
): { count: number; names: string[] } {
  return stackOverlap(
    players.map((player) => ({
      nickname: player.nickname,
      matchIds: gamesFor(stats, player.player_id, mapKey)
        .map((game) => game.matchId)
        .filter(Boolean),
    })),
  );
}

function overallForm(stats: LobbyStats, playerId: string): boolean[] {
  const row = stats.historyGames.find((item) => item.playerId === playerId);
  return (row?.games ?? []).slice(0, 5).map((game) => game.won);
}

function streak(form: boolean[]): "hot" | "cold" | undefined {
  if (form.length < STREAK) return undefined;
  const last = form.slice(0, STREAK);
  if (last.every(Boolean)) return "hot";
  if (last.every((won) => !won)) return "cold";
  return undefined;
}

function playerTag(
  player: PlayerMapStat,
  games: HistoryGame[],
  bestKd: number | null,
): { tag: string; tone: BriefTone } | undefined {
  const sample = player.sampleSize;
  if (player.games <= 1 && sample >= LABEL_MIN_SAMPLE) {
    return { tag: "Tourist", tone: "info" };
  }
  const mapForm = games.slice(0, STREAK).map((game) => game.won);
  const mapStreak = streak(mapForm);
  if (mapStreak === "cold") return { tag: "Cold", tone: "cold" };
  if (mapStreak === "hot") return { tag: "Hot", tone: "hot" };
  if (
    player.games >= 6 &&
    player.playRate >= MERCHANT_PLAY &&
    (player.winRate ?? 0) >= 0.55
  ) {
    return { tag: "Merchant", tone: "good" };
  }
  if (
    player.games >= FRAG_GAMES &&
    player.kd != null &&
    bestKd != null &&
    player.kd >= bestKd &&
    player.kd >= 1.12
  ) {
    return { tag: "Fragger", tone: "hot" };
  }
  return undefined;
}

function teamForm(
  stats: LobbyStats,
  team: TeamMapStat,
): "rolling" | "leaking" | undefined {
  const heaters = team.players.filter(
    (player) => streak(overallForm(stats, player.playerId)) === "hot",
  );
  const freezers = team.players.filter(
    (player) => streak(overallForm(stats, player.playerId)) === "cold",
  );
  if (heaters.length >= 3) return "rolling";
  if (freezers.length >= 3) return "leaking";
  return undefined;
}

function buildTeam(
  stats: LobbyStats,
  team: TeamMapStat,
  roster: { player_id: string; nickname: string }[],
  mapKey: string,
  adjust: boolean,
): TeamBrief {
  const qualifiedKd = team.players.filter(
    (player) => player.games >= FRAG_GAMES && player.kd != null,
  );
  const bestKd =
    qualifiedKd.length > 0
      ? Math.max(...qualifiedKd.map((player) => player.kd ?? 0))
      : null;

  const players: BriefPlayer[] = team.players.map((player) => {
    const games = gamesFor(stats, player.playerId, mapKey);
    const tagged = playerTag(player, games, bestKd);
    return {
      playerId: player.playerId,
      nickname: player.nickname,
      games: player.games,
      winRate: player.winRate,
      kd: player.kd,
      adr: avgOn(games, "adr"),
      recent: player.recent,
      tag: tagged?.tag,
      tagTone: tagged?.tone ?? "info",
    };
  });

  const stack = mapStack(stats, roster, mapKey);
  const adrs = players
    .map((player) => player.adr)
    .filter((value): value is number => value != null);
  const meanGames = team.players.length ? team.games / team.players.length : 0;

  return {
    games: team.games,
    winRate: displayWinRate(team, adjust),
    kd: team.kd,
    adr: mean(adrs),
    stack: stack.count,
    stackNames: stack.names,
    thin: meanGames < THIN_MEAN_GAMES,
    form: teamForm(stats, team),
    players,
  };
}

export function buildBriefing(
  stats: LobbyStats,
  mapKey: string,
  adjust: boolean,
): MatchBriefing | undefined {
  const you = stats.you.maps.find((row) => row.mapKey === mapKey);
  const them = stats.them.maps.find((row) => row.mapKey === mapKey);
  const entity = stats.maps.find((row) => row.class_name === mapKey);
  if (!you || !them || !entity) return undefined;

  const youBrief = buildTeam(stats, you, stats.you.players, mapKey, adjust);
  const themBrief = buildTeam(stats, them, stats.them.players, mapKey, adjust);
  const yours = youBrief.winRate ?? 0.5;
  const theirs = themBrief.winRate ?? 0.5;
  const gap = yours - theirs;
  let lean: MatchBriefing["lean"] = "even";
  let headline = `Even on ${entity.name}`;
  if (gap >= EDGE) {
    lean = "you";
    headline = `${entity.name} leans your way`;
  } else if (gap <= -EDGE) {
    lean = "them";
    headline = `They have the edge on ${entity.name}`;
  }

  const youGames = you.players.length ? you.games / you.players.length : 0;
  const themGames = them.players.length ? them.games / them.players.length : 0;
  if (lean === "even" && themGames - youGames >= 4) {
    headline = `They play ${entity.name} more`;
    lean = "them";
  } else if (lean === "even" && youGames - themGames >= 4) {
    headline = `You play ${entity.name} more`;
    lean = "you";
  }

  return {
    mapKey,
    displayName: entity.name,
    headline,
    lean,
    gap,
    you: youBrief,
    them: themBrief,
  };
}
