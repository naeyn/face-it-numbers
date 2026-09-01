import type {
  ExtensionMessage,
  LobbyStats,
  LobbyStatsError,
  LobbyStatsResponse,
} from "../lib/types";
import { votingOpen } from "../lib/briefing";
import { isMatchFinished } from "../lib/match-stats";
import {
  ERROR_BACKOFF_MAX_MS,
  FINISHED_POLL_MS,
  LOBBY_POLL_MS,
  VOTE_POLL_MS,
} from "../lib/constants";
import { extensionAlive, isContextInvalidated } from "../lib/extension";
import { absorbSmart } from "../lib/calibration";
import { SETTINGS_KEY, loadSettings } from "../lib/settings";
import {
  detectMyNickname,
  detectMyPlayerId,
  getFaceitToken,
  getMatchIdFromUrl,
} from "./detect-user";
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
let queuedRefresh = false;
let halted = false;
let failStreak = 0;

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

/**
 * Relabelling the sides needs no network: both rosters are already in hand.
 * Swapping locally is what makes the button feel instant — and what keeps it
 * working at all while Faceit is rate limiting us, when a refresh would fail
 * and leave the panel unchanged.
 */
function swapTeams(stats: LobbyStats): LobbyStats {
  return {
    ...stats,
    myFaction: stats.myFaction === "faction1" ? "faction2" : "faction1",
    // The user just told us which side is theirs, so the panel stops
    // second-guessing it even if we never found them in a roster.
    myFactionKnown: true,
    you: stats.them,
    them: stats.you,
    youWon: stats.youWon == null ? null : !stats.youWon,
    // These belong to the captain who is now on our side; the next successful
    // refresh refetches the other one's.
    captainDrops: [],
  };
}

function ensureOverlay(): Overlay {
  if (overlay) return overlay;
  overlay = new Overlay({
    onSwap: () => {
      swapped = !swapped;
      if (latestStats) {
        latestStats = swapTeams(latestStats);
        overlay?.render(latestStats);
        void injectMapCards(latestStats);
        void injectPlayerLabels(latestStats);
      }
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
  if (!matchId) return;
  // Never drop a refresh on the floor: a click that lands mid-poll used to be
  // silently ignored until the next tick, up to a minute away on backoff.
  if (inFlight) {
    queuedRefresh = true;
    return;
  }
  inFlight = true;
  try {
    const panel = ensureOverlay();
    const response = await send<LobbyStatsResponse>({
      type: "GET_LOBBY_STATS",
      matchId,
      myNickname: detectMyNickname(),
      myPlayerId: detectMyPlayerId(),
      swapped,
      token: getFaceitToken(),
    });

    if (currentMatchId !== matchId) return;

    if (!response.ok) {
      // Rate limits count double so the backoff opens up faster while the
      // shared API cooldown drains.
      failStreak = Math.min(failStreak + (response.error === "RATE_LIMITED" ? 2 : 1), 5);
      // A transient failure must not wipe an already-rendered briefing:
      // keep the stale data and surface the problem in the notice strip.
      if (latestStats) panel.setNotice(staleNotice(response));
      else if (response.error === "NOT_LOGGED_IN") panel.showNeedLogin();
      else panel.showError(response.message);
      return;
    }

    failStreak = 0;
    panel.setNotice(undefined);
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
    failStreak = Math.min(failStreak + 1, 5);
    const panel = ensureOverlay();
    if (latestStats) panel.setNotice("Refresh failed — showing last data");
    else {
      panel.showError(
        error instanceof Error ? error.message : "Could not load lobby stats.",
      );
    }
  } finally {
    inFlight = false;
    if (queuedRefresh) {
      queuedRefresh = false;
      void refresh();
    }
  }
}

function staleNotice(response: LobbyStatsError): string {
  if (response.error === "RATE_LIMITED") {
    return "Faceit is rate limiting — showing last data";
  }
  if (response.error === "NOT_LOGGED_IN") {
    return "Faceit session expired — log in again to refresh";
  }
  return "Refresh failed — showing last data";
}

function pollDelay(): number {
  const base = votingOpen(latestStats)
    ? VOTE_POLL_MS
    : latestStats && isMatchFinished(latestStats.status)
      ? FINISHED_POLL_MS
      : LOBBY_POLL_MS;
  if (failStreak === 0) return base;
  return Math.min(base * 2 ** failStreak, ERROR_BACKOFF_MAX_MS);
}

function schedulePoll(): void {
  if (halted || !currentMatchId) return;
  if (pollTimer != null) window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(() => {
    pollTimer = undefined;
    // Hidden tab = the user is in-game: polling would only burn rate limit.
    // The visibilitychange listener refreshes the moment they come back.
    if (document.hidden) {
      schedulePoll();
      return;
    }
    void refresh().finally(() => {
      schedulePoll();
    });
  }, pollDelay());
}

function startMatch(matchId: string): void {
  if (halted || currentMatchId === matchId) return;
  stopMatch();
  currentMatchId = matchId;
  swapped = false;
  queuedRefresh = false;
  ensureOverlay();
  cardObserver = observeMapCards(
    () => latestStats,
    (stats) => {
      latestStats = stats;
      overlay?.render(stats);
    },
    () => {
      void refresh();
    },
  );
  labelObserver = observePlayerLabels(() => latestStats);
  void refresh();
  schedulePoll();
}

function stopMatch(): void {
  currentMatchId = undefined;
  latestStats = undefined;
  failStreak = 0;
  if (pollTimer != null) {
    window.clearTimeout(pollTimer);
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
document.addEventListener("visibilitychange", () => {
  if (document.hidden || halted || !currentMatchId) return;
  void refresh();
  schedulePoll();
});
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
