import type { LobbyStats, MapEntity } from "./types";

/** Season 9 Active Duty — used only when the match has not published a pool yet. */
export const DEFAULT_CS2_POOL: MapEntity[] = [
  { class_name: "de_dust2", name: "Dust 2" },
  { class_name: "de_mirage", name: "Mirage" },
  { class_name: "de_nuke", name: "Nuke" },
  { class_name: "de_ancient", name: "Ancient" },
  { class_name: "de_inferno", name: "Inferno" },
  { class_name: "de_anubis", name: "Anubis" },
  { class_name: "de_cache", name: "Cache" },
];

/** Optional / legacy maps we still recognize for stats, names, and DOM detection. */
const EXTRA_KNOWN: MapEntity[] = [
  { class_name: "de_vertigo", name: "Vertigo" },
  { class_name: "de_overpass", name: "Overpass" },
  { class_name: "de_train", name: "Train" },
];

export const KNOWN_MAPS: MapEntity[] = [...DEFAULT_CS2_POOL, ...EXTRA_KNOWN];

const ALIASES: Record<string, string> = {
  dust2: "de_dust2",
  dust_2: "de_dust2",
  "dust 2": "de_dust2",
  mirage: "de_mirage",
  inferno: "de_inferno",
  nuke: "de_nuke",
  ancient: "de_ancient",
  anubis: "de_anubis",
  vertigo: "de_vertigo",
  overpass: "de_overpass",
  train: "de_train",
  cache: "de_cache",
  ancient_wing: "de_ancient",
};

export function isMapClassName(raw: string): boolean {
  if (!raw.trim() || /^\d+$/.test(raw.trim())) return false;
  const key = normalizeMapKey(raw, KNOWN_MAPS);
  if (KNOWN_MAPS.some((entity) => entity.class_name === key)) return true;
  return /^de_[a-z][a-z0-9_]*$/i.test(key);
}

export function knownEntity(mapKey: string): MapEntity | undefined {
  const key = normalizeMapKey(mapKey, KNOWN_MAPS);
  return KNOWN_MAPS.find((entity) => entity.class_name === key);
}

export function uniqueEntities(list: MapEntity[]): MapEntity[] {
  const seen = new Set<string>();
  const result: MapEntity[] = [];
  for (const entity of list) {
    const key = normalizeMapKey(entity.class_name, KNOWN_MAPS);
    if (!key || seen.has(key) || !isMapClassName(key)) continue;
    seen.add(key);
    result.push({
      ...entity,
      class_name: key,
      name: entity.name || knownEntity(key)?.name || displayNameFor(key, KNOWN_MAPS),
    });
  }
  return result;
}

export function normalizeMapKey(raw: string, pool: MapEntity[]): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const lower = trimmed.toLowerCase();
  const compact = lower.replace(/\s+/g, "");
  const search = pool.length > 0 ? pool : KNOWN_MAPS;

  for (const entity of search) {
    if (entity.class_name.toLowerCase() === lower) return entity.class_name;
    if (entity.name.toLowerCase() === lower) return entity.class_name;
    if (entity.name.toLowerCase().replace(/\s+/g, "") === compact) {
      return entity.class_name;
    }
    if (entity.class_name.replace(/^de_/, "") === compact) return entity.class_name;
  }

  if (ALIASES[lower] || ALIASES[compact]) {
    return ALIASES[lower] ?? ALIASES[compact];
  }

  if (lower.startsWith("de_")) return lower;
  return `de_${compact}`;
}

export function displayNameFor(mapKey: string, pool: MapEntity[]): string {
  const entity =
    pool.find((item) => item.class_name === mapKey) ?? knownEntity(mapKey);
  if (entity) return entity.name;
  return mapKey.replace(/^de_/, "").replace(/_/g, " ");
}

export function shortLabel(displayName: string): string {
  const compact = displayName.toLowerCase().replace(/\s+/g, "");
  if (compact === "dust2") return "D2";
  if (compact === "inferno") return "Inf";
  if (compact === "ancient") return "Anc";
  if (compact === "anubis") return "Anub";
  if (compact === "vertigo") return "Vert";
  return displayName.length > 6 ? displayName.slice(0, 6) : displayName;
}

export function poolKeys(pool: MapEntity[]): string {
  return pool.map((entity) => entity.class_name).join(",");
}

export function restrictLobbyMaps(stats: LobbyStats, pool: MapEntity[]): LobbyStats {
  const maps = uniqueEntities(pool);
  if (maps.length < 4) return stats;
  if (poolKeys(maps) === poolKeys(stats.maps)) return stats;
  return { ...stats, maps };
}
