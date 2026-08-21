import { CAPTAIN_MATCH_LIMIT, CACHE_TTL_MS, FETCH_CONCURRENCY } from "./constants";
import { faceitGet, mapPool } from "./faceit-api";
import { normalizeMapKey } from "./maps";
import type { DropRate, MapEntity } from "./types";

type CacheEntry = { at: number; drops: DropRate[] };
const dropCache = new Map<string, CacheEntry>();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function matchIdOf(row: Record<string, unknown>): string | undefined {
  return asString(row.matchId) ?? asString(row.match_id) ?? asString(row.id);
}

function leaderOf(teams: Record<string, unknown> | undefined, faction: string): string | undefined {
  const side = asRecord(teams?.[faction]);
  return asString(side?.leader) ?? asString(side?.leader_id);
}

function captainFaction(
  teams: Record<string, unknown> | undefined,
  captainId: string,
): "faction1" | "faction2" | undefined {
  if (leaderOf(teams, "faction1") === captainId) return "faction1";
  if (leaderOf(teams, "faction2") === captainId) return "faction2";
  return undefined;
}

async function playerHistory(
  captainId: string,
  token: string | undefined,
): Promise<unknown[]> {
  const paths = [
    `/match-history/v5/players/${captainId}/history/?page=0&size=30`,
    `/match-history/v5/players/${captainId}/history/?offset=0&limit=30`,
  ];
  for (const path of paths) {
    try {
      const raw = await faceitGet(path, token);
      if (Array.isArray(raw)) return raw;
      const record = asRecord(raw);
      if (Array.isArray(record?.items)) return record.items as unknown[];
    } catch {
      /* try next */
    }
  }
  return [];
}

function isRankedFive(row: Record<string, unknown>): boolean {
  const competition = asRecord(row.competition);
  const name = (asString(competition?.name) ?? "").toLowerCase();
  const type = (asString(competition?.type) ?? asString(row.type) ?? "").toLowerCase();
  const game = (asString(row.game) ?? "cs2").toLowerCase();
  if (game && game !== "cs2" && game !== "csgo") return false;
  if (type.includes("1v1") || type.includes("2v2")) return false;
  if (name.includes("1v1") || name.includes("2v2")) return false;
  return true;
}

async function vetoDropsForMatch(
  matchId: string,
  faction: "faction1" | "faction2",
  token: string | undefined,
): Promise<string[]> {
  try {
    const raw = await faceitGet(`/democracy/v1/match/${matchId}/history`, token);
    const payload = asRecord(raw) ?? {};
    const tickets = asArray(payload.tickets);
    const dropped: string[] = [];
    for (const ticket of tickets) {
      const row = asRecord(ticket);
      if (!row) continue;
      const entityType = (asString(row.entity_type) ?? "").toLowerCase();
      if (entityType && entityType !== "map" && entityType !== "maps") continue;
      for (const entity of asArray(row.entities)) {
        const item = asRecord(entity);
        if (!item) continue;
        const status = (asString(item.status) ?? asString(row.vote_type) ?? "").toLowerCase();
        const selectedBy = asString(item.selected_by);
        if (!status.includes("drop")) continue;
        if (selectedBy && selectedBy !== faction) continue;
        const guid = asString(item.guid) ?? asString(item.class_name);
        if (guid) dropped.push(guid);
      }
    }
    return dropped;
  } catch {
    return [];
  }
}

export async function fetchCaptainDrops(
  captainId: string | undefined,
  pool: MapEntity[],
  token: string | undefined,
): Promise<DropRate[]> {
  if (!captainId) return [];
  const now = Date.now();
  const cached = dropCache.get(captainId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.drops;

  const session = await chrome.storage.session.get(`finDrops:${captainId}`);
  const stored = session[`finDrops:${captainId}`] as CacheEntry | undefined;
  if (stored && now - stored.at < CACHE_TTL_MS) {
    dropCache.set(captainId, stored);
    return stored.drops;
  }

  const history = await playerHistory(captainId, token);
  const captainMatches = history
    .map((item) => asRecord(item))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .filter((row) => isRankedFive(row) && captainFaction(asRecord(row.teams), captainId))
    .slice(0, CAPTAIN_MATCH_LIMIT);

  const counts = new Map<string, { drops: number; chances: number }>();
  for (const entity of pool) {
    counts.set(entity.class_name, { drops: 0, chances: 0 });
  }

  await mapPool(captainMatches, FETCH_CONCURRENCY, async (row) => {
    const id = matchIdOf(row);
    const faction = captainFaction(asRecord(row.teams), captainId);
    if (!id || !faction) return;
    const dropped = await vetoDropsForMatch(id, faction, token);
    for (const entity of pool) {
      const current = counts.get(entity.class_name)!;
      current.chances += 1;
      const key = normalizeMapKey(entity.class_name, pool);
      if (dropped.some((guid) => normalizeMapKey(guid, pool) === key)) {
        current.drops += 1;
      }
    }
  });

  const drops: DropRate[] = pool.map((entity) => {
    const current = counts.get(entity.class_name) ?? { drops: 0, chances: 0 };
    return {
      mapKey: entity.class_name,
      drops: current.drops,
      chances: current.chances,
      rate: current.chances > 0 ? current.drops / current.chances : null,
    };
  });

  const entry = { at: now, drops };
  dropCache.set(captainId, entry);
  void chrome.storage.session.set({ [`finDrops:${captainId}`]: entry });
  return drops;
}
