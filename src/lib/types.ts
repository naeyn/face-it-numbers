export type FactionId = "faction1" | "faction2";

export type RosterPlayer = {
  player_id: string;
  nickname: string;
  avatar?: string;
  game_skill_level?: number;
  elo?: number;
  steam64?: string;
};

export type MapEntity = {
  class_name: string;
  name: string;
  image_sm?: string;
  image_lg?: string;
};

export type MatchVoting = {
  map?: {
    entities?: MapEntity[];
    pick?: string[];
    drop?: string[];
  };
};

export type MatchDetails = {
  match_id: string;
  game: string;
  status: string;
  startedAt?: number;
  teams: {
    faction1: { name?: string; leader?: string; roster: RosterPlayer[] };
    faction2: { name?: string; leader?: string; roster: RosterPlayer[] };
  };
  voting?: MatchVoting;
};

export type PlayerMatchItem = {
  stats: Record<string, string>;
};

export type PlayerStatsResponse = {
  items: PlayerMatchItem[];
};

export type HistoryGame = {
  matchId: string;
  mapKey: string;
  kd: number | null;
  adr: number | null;
  hsPct: number | null;
  kr: number | null;
  won: boolean;
  at: number;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  rounds: number | null;
  mvps: number | null;
  tripleKills: number | null;
  quadroKills: number | null;
  pentaKills: number | null;
};

export type RoleStats = {
  rounds: number | null;
  entryCount: number | null;
  entryWins: number | null;
  sniperKills: number | null;
  utilityDamage: number | null;
  enemiesFlashed: number | null;
  flashSuccesses: number | null;
  oneV1Wins: number | null;
  oneV1Count: number | null;
  oneV2Wins: number | null;
  oneV2Count: number | null;
  tripleKills: number | null;
  quadroKills: number | null;
  pentaKills: number | null;
  mvps: number | null;
  pistolKills: number | null;
  knifeKills: number | null;
  zeusKills: number | null;
  headshots: number | null;
  headshotPct: number | null;
};

export type RoleLabelKey =
  | "humiliation"
  | "clutcher"
  | "highlight"
  | "opener"
  | "awper"
  | "onetapper"
  | "closer"
  | "spacetaker"
  | "utilityking"
  | "pistoldemon"
  | "damagedealer"
  | "support"
  | "trader"
  | "flashsupport"
  | "crosshair"
  | "spray"
  | "reflexes"
  | "sided";

export type RoleLabel = {
  playerId: string;
  nickname: string;
  key: RoleLabelKey;
  text: string;
  tone: "good" | "bad" | "info";
  detail: string;
  source: "history" | "leetify";
};

export type GameLabelKey =
  | "lifegame"
  | "brick"
  | "carry"
  | "passenger"
  | "bounce"
  | "tilted"
  | "cooking"
  | "offgame"
  | "merchant"
  | "tourist";

export type GameLabel = {
  playerId: string;
  nickname: string;
  key: GameLabelKey;
  text: string;
  tone: "hot" | "good" | "bad" | "cold" | "info";
  detail: string;
};

export type PlayerMapStat = {
  playerId: string;
  nickname: string;
  mapKey: string;
  games: number;
  wins: number;
  winRate: number | null;
  playRate: number;
  sampleSize: number;
  kd: number | null;
  recent: boolean[];
};

export type TeamMapStat = {
  mapKey: string;
  displayName: string;
  games: number;
  wins: number;
  winRate: number | null;
  playRate: number;
  dropped: boolean;
  picked: boolean;
  kd: number | null;
  players: PlayerMapStat[];
};

export type TeamInsight = {
  stack: number;
  stackNames: string[];
  elo: number | null;
  eloDelta: number | null;
};

export type DropRate = {
  mapKey: string;
  drops: number;
  chances: number;
  rate: number | null;
};

export type PlayerHistory = {
  byMap: Map<string, PlayerMapStat>;
  matchIds: string[];
  games: HistoryGame[];
  elo: number | null;
  eloDelta: number | null;
};

export type TeamStats = {
  faction: FactionId;
  name: string;
  players: RosterPlayer[];
  maps: TeamMapStat[];
  insight: TeamInsight;
};

export type LobbyStats = {
  matchId: string;
  status: string;
  myNickname?: string;
  myFaction: FactionId;
  you: TeamStats;
  them: TeamStats;
  maps: MapEntity[];
  captainDrops: DropRate[];
  labels: GameLabel[];
  roles: RoleLabel[];
  historyGames: Array<{ playerId: string; nickname: string; games: HistoryGame[] }>;
  youWon: boolean | null;
  matchAt?: number;
  smart?: SmartSummary;
};

export type SmartSummary = {
  n: number;
  needed: number;
  ready: boolean;
  hits: number;
  decided: number;
  bias: Record<string, number>;
  biasGlobal: number;
};

export type GetLobbyStatsMessage = {
  type: "GET_LOBBY_STATS";
  matchId: string;
  myNickname?: string;
  swapped?: boolean;
  token?: string;
};

export type OpenOptionsMessage = {
  type: "OPEN_OPTIONS";
};

export type ExtensionMessage = GetLobbyStatsMessage | OpenOptionsMessage;

export type LobbyStatsSuccess = {
  ok: true;
  data: LobbyStats;
};

export type LobbyStatsError = {
  ok: false;
  error: "NOT_LOGGED_IN" | "MATCH_NOT_FOUND" | "RATE_LIMITED" | "API_ERROR";
  message: string;
};

export type LobbyStatsResponse = LobbyStatsSuccess | LobbyStatsError;
