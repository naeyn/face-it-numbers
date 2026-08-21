import { extensionAlive, isContextInvalidated } from "./extension";

export const SETTINGS_KEY = "finSettings";
export const LEGACY_PREFS_KEY = "finViewPrefs";

export type FeatureKey =
  | "sortBest"
  | "adjust"
  | "suggestBanPick"
  | "permLabels"
  | "thinSample"
  | "captainDrops"
  | "stackOverlap"
  | "eloSwing"
  | "recentForm"
  | "mapKd"
  | "outlier"
  | "gameLabels"
  | "preBrief"
  | "smartPick";

export type FeatureSettings = Record<FeatureKey, boolean>;

export const DEFAULT_SETTINGS: FeatureSettings = {
  sortBest: true,
  adjust: true,
  suggestBanPick: true,
  permLabels: true,
  thinSample: true,
  captainDrops: true,
  stackOverlap: true,
  eloSwing: true,
  recentForm: true,
  mapKd: true,
  outlier: true,
  gameLabels: true,
  preBrief: true,
  smartPick: true,
};

export const FEATURE_GROUPS: {
  title: string;
  items: { key: FeatureKey; label: string; hint: string }[];
}[] = [
  {
    title: "Chart",
    items: [
      { key: "sortBest", label: "Sort best pick first", hint: "Left = your best map; banned maps stay faded in place" },
      { key: "adjust", label: "Shrink tiny samples", hint: "Pull low-game WRs toward 50%" },
      { key: "suggestBanPick", label: "Ban / pick suggestion", hint: "One line under the chart" },
      { key: "permLabels", label: "Perm / ban labels", hint: "BAN / PERM / THEIRS above the win-rate gap" },
      { key: "thinSample", label: "Thin-sample warning", hint: "Fade a side with fewer than 5 games on that map" },
    ],
  },
  {
    title: "Lobby context",
    items: [
      { key: "stackOverlap", label: "Stack overlap", hint: "Last-30 games where at least 3 of this roster queued together" },
      { key: "eloSwing", label: "Elo", hint: "Team average Elo now, with last-30 change in parentheses" },
      { key: "captainDrops", label: "Enemy captain drops", hint: "How often they veto each map" },
      {
        key: "preBrief",
        label: "Pre-match briefing",
        hint: "After veto, a Brief tab with last-30 intel on the picked map",
      },
      {
        key: "smartPick",
        label: "Smart pick",
        hint: "Calibrates from your finished lobbies, then biases ban/pick toward maps you actually convert",
      },
    ],
  },
  {
    title: "Map click details",
    items: [
      { key: "recentForm", label: "Recent form", hint: "Last 8 results on that map" },
      { key: "mapKd", label: "K/D", hint: "Average K/D on that map" },
      { key: "outlier", label: "Outlier player", hint: "Who is dragging or carrying the WR" },
    ],
  },
  {
    title: "Post game",
    items: [
      {
        key: "gameLabels",
        label: "Performance labels",
        hint: "Lifegame, Brick, Carry… vs that player’s last 30",
      },
    ],
  },
];

export function mergeSettings(raw: unknown): FeatureSettings {
  const base = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as FeatureKey[]) {
    if (typeof record[key] === "boolean") base[key] = record[key];
  }
  return base;
}

export async function loadSettings(): Promise<FeatureSettings> {
  if (!extensionAlive()) return { ...DEFAULT_SETTINGS };
  try {
    const stored = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_PREFS_KEY]);
    if (stored[SETTINGS_KEY] != null) return mergeSettings(stored[SETTINGS_KEY]);
    const merged = mergeSettings(undefined);
    const legacy = stored[LEGACY_PREFS_KEY] as
      | { sortBest?: boolean; adjust?: boolean }
      | undefined;
    if (legacy) {
      if (typeof legacy.sortBest === "boolean") merged.sortBest = legacy.sortBest;
      if (typeof legacy.adjust === "boolean") merged.adjust = legacy.adjust;
    }
    return merged;
  } catch (error) {
    if (isContextInvalidated(error)) return { ...DEFAULT_SETTINGS };
    throw error;
  }
}

export async function saveSettings(settings: FeatureSettings): Promise<void> {
  if (!extensionAlive()) return;
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    await chrome.storage.local.remove(LEGACY_PREFS_KEY);
  } catch (error) {
    if (isContextInvalidated(error)) return;
    throw error;
  }
}

export async function patchSettings(
  patch: Partial<FeatureSettings>,
): Promise<FeatureSettings> {
  const next = { ...(await loadSettings()), ...patch };
  await saveSettings(next);
  return next;
}
