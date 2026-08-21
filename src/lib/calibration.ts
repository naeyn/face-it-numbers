import {
  SMART_KEY,
  SMART_MAP_MIN,
  SMART_MAX_SAMPLES,
  SMART_MIN_SAMPLES,
} from "./constants";
import { extensionAlive, isContextInvalidated } from "./extension";
import { isMatchFinished } from "./match-stats";
import { pickAdvantage } from "./scoring";
import type { LobbyStats, SmartSummary } from "./types";

export type SmartSample = {
  matchId: string;
  mapKey: string;
  gap: number;
  won: boolean;
  at: number;
};

type SmartStore = {
  samples: SmartSample[];
};

function expected(gap: number): number {
  return Math.min(0.82, Math.max(0.18, 0.5 + gap));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function residual(sample: SmartSample): number {
  return (sample.won ? 1 : 0) - expected(sample.gap);
}

export function summarizeSmart(samples: SmartSample[]): SmartSummary {
  const decided = samples.filter((sample) => Math.abs(sample.gap) >= 0.05);
  const hits = decided.filter((sample) => (sample.gap >= 0) === sample.won).length;
  const biasGlobal = mean(samples.map(residual));
  const byMap = new Map<string, SmartSample[]>();
  for (const sample of samples) {
    const list = byMap.get(sample.mapKey) ?? [];
    list.push(sample);
    byMap.set(sample.mapKey, list);
  }
  const bias: Record<string, number> = {};
  for (const [mapKey, list] of byMap) {
    const local = mean(list.map(residual));
    if (list.length >= SMART_MAP_MIN) {
      const weight = list.length / (list.length + 4);
      bias[mapKey] = weight * local + (1 - weight) * biasGlobal;
    }
  }
  return {
    n: samples.length,
    needed: SMART_MIN_SAMPLES,
    ready: samples.length >= SMART_MIN_SAMPLES,
    hits,
    decided: decided.length,
    bias,
    biasGlobal,
  };
}

export function smartAdvantage(
  gap: number,
  mapKey: string,
  smart: SmartSummary | undefined,
): number {
  if (!smart?.ready) return gap;
  return gap + (smart.bias[mapKey] ?? smart.biasGlobal);
}

async function readStore(): Promise<SmartStore> {
  if (!extensionAlive()) return { samples: [] };
  try {
    const stored = await chrome.storage.local.get(SMART_KEY);
    const raw = stored[SMART_KEY] as SmartStore | undefined;
    if (!raw || !Array.isArray(raw.samples)) return { samples: [] };
    return { samples: raw.samples };
  } catch (error) {
    if (isContextInvalidated(error)) return { samples: [] };
    throw error;
  }
}

async function writeStore(store: SmartStore): Promise<void> {
  if (!extensionAlive()) return;
  try {
    await chrome.storage.local.set({ [SMART_KEY]: store });
  } catch (error) {
    if (isContextInvalidated(error)) return;
    throw error;
  }
}

function pickedKey(stats: LobbyStats): string | undefined {
  return stats.you.maps.find((row) => row.picked)?.mapKey;
}

export async function absorbSmart(stats: LobbyStats): Promise<SmartSummary> {
  const store = await readStore();
  if (isMatchFinished(stats.status) && stats.youWon != null) {
    const mapKey = pickedKey(stats);
    const you = stats.you.maps.find((row) => row.mapKey === mapKey);
    const them = stats.them.maps.find((row) => row.mapKey === mapKey);
    if (
      mapKey &&
      you &&
      them &&
      !store.samples.some((sample) => sample.matchId === stats.matchId)
    ) {
      store.samples.unshift({
        matchId: stats.matchId,
        mapKey,
        gap: pickAdvantage(you, them, true),
        won: stats.youWon,
        at: Date.now(),
      });
      store.samples = store.samples.slice(0, SMART_MAX_SAMPLES);
      await writeStore(store);
    }
  }
  return summarizeSmart(store.samples);
}
