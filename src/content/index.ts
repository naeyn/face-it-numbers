import type { ExtensionMessage, LobbyStats, LobbyStatsResponse } from "../lib/types";
import { extensionAlive, isContextInvalidated } from "../lib/extension";
import { absorbSmart } from "../lib/calibration";
import { SETTINGS_KEY, loadSettings } from "../lib/settings";
import { detectMyNickname, getFaceitToken, getMatchIdFromUrl } from "./detect-user";
import {
  clearMapCards,
  injectMapCards,
  observeMapCards,
  applyVisiblePool,
} from "./map-cards";
import { Overlay } from "./overlay";
import {
  clearPlayerLabels,
  injectPlayerLabels,
  observePlayerLabels,
} from "./player-labels";

const POLL_MS = 8000;
const URL_CHECK_MS = 500;

let overlay: Overlay | undefined;
let currentMatchId: string | undefined;
let swapped = false;
let latestStats: LobbyStats | undefined;
let pollTimer: number | undefined;
let urlTimer: number | undefined;
let cardObserver: MutationObserver | undefined;
let labelObserver: MutationObserver | undefined;
let inFlight = false;
let halted = false;

function send<T>(message: ExtensionMessage): Promise<T> {
  if (!extensionAlive()) {
    return Promise.reject(new Error("Extension context invalidated."));
  }
  try {
    return chrome.runtime.sendMessage(message) as Promise<T>;
  } catch (error) {
    return Promise.reject(error);
  }
}

function halt(): void {
  if (halted) return;
  halted = true;
  stopMatch();
  if (urlTimer != null) {
    window.clearInterval(urlTimer);
    urlTimer = undefined;
  }
}

function ensureOverlay(): Overlay {
  if (overlay) return overlay;
  overlay = new Overlay({
    onSwap: () => {
      swapped = !swapped;
      void refresh();
    },
  });
  return overlay;
}

async function refresh(): Promise<void> {
  if (!extensionAlive()) {
    halt();
    return;
  }
  const matchId = currentMatchId;
  if (!matchId || inFlight) return;
  inFlight = true;
  try {
    const panel = ensureOverlay();
    const response = await send<LobbyStatsResponse>({
      type: "GET_LOBBY_STATS",
      matchId,
      myNickname: detectMyNickname(),
      swapped,
      token: getFaceitToken(),
    });

    if (currentMatchId !== matchId) return;

    if (!response.ok) {
      if (response.error === "NOT_LOGGED_IN") panel.showNeedLogin();
      else panel.showError(response.message);
      return;
    }

    latestStats = applyVisiblePool(response.data);
    latestStats.smart = await absorbSmart(latestStats);
    panel.render(latestStats);
    void injectMapCards(latestStats);
    void injectPlayerLabels(latestStats);
  } catch (error) {
    if (isContextInvalidated(error)) {
      halt();
      return;
    }
    ensureOverlay().showError(
      error instanceof Error ? error.message : "Could not load lobby stats.",
    );
  } finally {
    inFlight = false;
  }
}

function startMatch(matchId: string): void {
  if (halted || currentMatchId === matchId) return;
  stopMatch();
  currentMatchId = matchId;
  swapped = false;
  ensureOverlay();
  cardObserver = observeMapCards(
    () => latestStats,
    (stats) => {
      latestStats = stats;
      overlay?.render(stats);
    },
  );
  labelObserver = observePlayerLabels(() => latestStats);
  void refresh();
  pollTimer = window.setInterval(() => {
    void refresh();
  }, POLL_MS);
}

function stopMatch(): void {
  currentMatchId = undefined;
  latestStats = undefined;
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
  cardObserver?.disconnect();
  cardObserver = undefined;
  labelObserver?.disconnect();
  labelObserver = undefined;
  overlay?.destroy();
  overlay = undefined;
  clearMapCards();
  clearPlayerLabels();
}

function syncFromUrl(): void {
  if (!extensionAlive()) {
    halt();
    return;
  }
  const matchId = getMatchIdFromUrl();
  if (matchId) startMatch(matchId);
  else if (currentMatchId) stopMatch();
}

syncFromUrl();
urlTimer = window.setInterval(syncFromUrl, URL_CHECK_MS);
window.addEventListener("popstate", syncFromUrl);
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!extensionAlive()) {
      halt();
      return;
    }
    if (area !== "local" || !changes[SETTINGS_KEY]) return;
    void (async () => {
      const settings = await loadSettings();
      overlay?.setSettings(settings);
      if (!latestStats) return;
      overlay?.render(latestStats);
      void injectMapCards(latestStats);
      void injectPlayerLabels(latestStats);
    })();
  });
} catch {
  halt();
}
