import type { GameLabel, GameLabelKey, LobbyStats, PlayerHistory } from "../lib/types";
import { loadSettings } from "../lib/settings";
import { assignGameLabels } from "../lib/game-labels";
import type { ThisGameLine } from "../lib/match-stats";

const ATTR = "data-fin-label";
const STYLE_ID = "faceit-numbers-player-labels";

const LABEL_CSS = `
.fin-player-label {
  display: inline-flex !important;
  align-items: center;
  margin-left: 4px !important;
  margin-right: 4px !important;
  padding: 2px 7px !important;
  border-radius: 4px;
  font-size: 11px !important;
  font-weight: 800 !important;
  letter-spacing: 0.03em;
  line-height: 1.3;
  vertical-align: middle;
  cursor: help;
  white-space: nowrap;
  position: relative;
  z-index: 2147483000;
}
.fin-label-host {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: center !important;
}
.fin-player-label.compact {
  width: 22px !important;
  height: 22px !important;
  padding: 0 !important;
  margin: 0 0 0 6px !important;
  flex: 0 0 22px !important;
  justify-content: center;
  align-self: center;
  overflow: visible !important;
  border-radius: 4px;
}
.fin-player-label.compact svg {
  width: 14px;
  height: 14px;
  display: block;
  fill: currentColor;
  pointer-events: none;
}
.fin-player-label.hot { background: #ff5500 !important; color: #fff !important; }
.fin-player-label.good { background: #1f4a28 !important; color: #9ee59e !important; }
.fin-player-label.bad { background: #4a2a1f !important; color: #f0b090 !important; }
.fin-player-label.cold { background: #4a1f1f !important; color: #ff9a9a !important; }
.fin-player-label.info { background: #2a3344 !important; color: #9ec1ff !important; }
#fin-label-tip {
  position: fixed;
  z-index: 2147483646;
  max-width: 280px;
  padding: 8px 10px;
  background: #161a22;
  color: #f2f4f8;
  border: 1px solid #3d4656;
  border-radius: 6px;
  box-shadow: 0 10px 28px rgba(0,0,0,.5);
  font-size: 12px;
  line-height: 1.35;
  pointer-events: none;
}
#fin-label-tip .fin-tip-name {
  font-weight: 800;
  letter-spacing: 0.02em;
  margin-bottom: 2px;
}
#fin-label-tip .fin-tip-hint { color: #d5dbe6; }
#fin-label-tip .fin-tip-detail {
  color: #9aa6b8;
  margin-top: 5px;
  font-size: 11px;
}
`;

const TIP_ID = "fin-label-tip";

const LABEL_HINTS: Record<GameLabelKey, string> = {
  lifegame: "One of this player's best games in the prior 30",
  brick: "One of this player's worst games in the prior 30",
  carry: "Top of their team and well above their usual",
  passenger: "Won while finishing last on their team",
  bounce: "Won after three losses, back near their level",
  tilted: "Lost after three losses and still below usual",
  cooking: "Clearly above their recent average",
  offgame: "Clearly below their recent average",
  merchant: "Strong game on a map they usually play well",
  tourist: "Extreme game on a map they barely play",
};

const ICON_PATHS: Record<GameLabelKey, string> = {
  lifegame: "M8 1.3 9.8 5.6l4.7.4-3.5 3.1 1.1 4.6L8 11.4 3.9 13.7l1.1-4.6L1.5 6l4.7-.4z",
  brick: "M1 2.5h6.4v4.2H1zm7.6 0H15v4.2H8.6zM1 8.3h4.2V13H1zm5.8 0H15V13H6.8z",
  carry: "M2 12.8h12l-.8-5.3-3.2 2.2L8 3.2 6 9.7 2.8 7.5z",
  passenger: "M8 1.8a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM3.2 14.2c0-2.9 2.1-4.7 4.8-4.7s4.8 1.8 4.8 4.7z",
  bounce: "M3.2 7.2h6.2a2.6 2.6 0 0 1 0 5.2H8v-1.7h1.4a.9.9 0 0 0 0-1.8H3.2l2-2-1.3-1.2L1 8.3l2.9 3.6 1.3-1.2z",
  tilted: "M9.2 1.2 3.8 8.6h3.7l-.9 6.2 6.2-8.6H9.1l1.1-5z",
  cooking: "M5.2 6.4c0-1.7 1-3 2-3 .4-1.1 1.2-1.9 1.8-1.9s1.4.8 1.8 1.9c1 0 2 1.3 2 3zm-.4.9h7.4v2H4.8zm.8 2.5h5.8V13H5.6z",
  offgame: "M10.2 2.2a6.2 6.2 0 1 0 3.9 10.4A5.6 5.6 0 0 1 10.2 2.2z",
  merchant: "M1.2 6.2 2.6 3h10.8l1.4 3.2zm1 1h11.6v6.6H2.2zm3.2 1.6h2.2v5H5.4z",
  tourist: "M5.2 3.2V2h5.6v1.2H14v3.2H2V3.2zm-2 4h11.6v6.6H3.2z",
};

function ensureStyle(): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.documentElement.append(style);
  }
  style.textContent = LABEL_CSS;
}

function hideTip(): void {
  document.getElementById(TIP_ID)?.remove();
}

function showTip(anchor: HTMLElement, label: GameLabel): void {
  hideTip();
  const tip = document.createElement("div");
  tip.id = TIP_ID;
  const name = document.createElement("div");
  name.className = "fin-tip-name";
  name.textContent = label.text;
  const hint = document.createElement("div");
  hint.className = "fin-tip-hint";
  hint.textContent = LABEL_HINTS[label.key];
  const detail = document.createElement("div");
  detail.className = "fin-tip-detail";
  detail.textContent = label.detail;
  tip.append(name, hint, detail);
  document.documentElement.append(tip);
  const rect = anchor.getBoundingClientRect();
  const width = tip.offsetWidth;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  const top = rect.bottom + 8;
  const flip = top + tip.offsetHeight > window.innerHeight - 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${flip ? Math.max(8, rect.top - tip.offsetHeight - 8) : top}px`;
}

function nicknamesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function nickFromHref(href: string): string | undefined {
  const match = href.match(/\/players\/([^/?#]+)/i);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

function inSiteChrome(el: Element): boolean {
  if (
    el.closest("#faceit-numbers-overlay") ||
    el.closest(".fin-player-label") ||
    el.closest("#fin-label-tip")
  ) {
    return true;
  }
  if (el.closest("nav")) return true;
  const rect = el.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= 72 && rect.height < 72;
}

function* deepElements(root: ParentNode): Generator<Element> {
  const list = root.querySelectorAll("*");
  for (const el of list) {
    yield el;
    if (el.shadowRoot) yield* deepElements(el.shadowRoot);
  }
}

function iconFor(key: GameLabelKey): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICON_PATHS[key]);
  svg.append(path);
  return svg;
}

function badgeFor(label: GameLabel, compact: boolean): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `fin-player-label ${label.tone}${compact ? " compact" : ""}`;
  span.setAttribute(ATTR, label.playerId);
  span.setAttribute("data-fin-sig", `${label.key}:${label.detail}`);
  span.setAttribute("aria-label", `${label.text}. ${LABEL_HINTS[label.key]}. ${label.detail}`);
  span.addEventListener("mouseenter", () => showTip(span, label));
  span.addEventListener("mouseleave", hideTip);
  if (compact) span.append(iconFor(label.key));
  else span.textContent = label.text;
  return span;
}

function alreadyLabeled(node: Element, playerId: string): boolean {
  const parent = node.parentElement;
  if (parent?.querySelector(`[${ATTR}="${playerId}"]`)) return true;
  if (node.nextElementSibling?.getAttribute(ATTR) === playerId) return true;
  return false;
}

function isCompactRow(row: Element): boolean {
  if (/Last\s+\d+\s+matches/i.test(row.textContent ?? "")) return false;
  const rect = row.getBoundingClientRect();
  return !(rect.height >= 110);
}

function scoreboardName(row: Element, nickname: string): Element | undefined {
  const inner = innermostName(row, nickname);
  if (!inner) return undefined;
  const link = inner.closest("a");
  if (!link || !row.contains(link)) return inner;
  const fromHref = nickFromHref(link.getAttribute("href") ?? "");
  if (fromHref && !nicknamesEqual(fromHref, nickname)) return inner;
  return link;
}

function markInlineHost(node: Element): void {
  const host = node.parentElement;
  if (!host) return;
  const tag = host.tagName;
  if (tag === "TR" || tag === "TABLE" || tag === "TBODY" || tag === "THEAD") return;
  host.classList.add("fin-label-host");
}

function attachBadge(node: Element, label: GameLabel, compact: boolean): void {
  if (alreadyLabeled(node, label.playerId)) return;
  node.after(badgeFor(label, compact));
  if (compact) markInlineHost(node);
}

function nameMatches(el: Element, nickname: string): boolean {
  const href = el.getAttribute("href") ?? "";
  const fromHref = nickFromHref(href);
  if (fromHref && nicknamesEqual(fromHref, nickname)) return true;
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return nicknamesEqual(text, nickname);
}

function rosterNicks(stats: LobbyStats): string[] {
  return [...stats.you.players, ...stats.them.players].map((player) => player.nickname);
}

function hasNick(root: Element, nickname: string): boolean {
  for (const el of [root, ...root.querySelectorAll("a, span, div, p, strong")]) {
    if (nameMatches(el, nickname)) return true;
  }
  return false;
}

function findRow(start: Element, nickname: string, allNicks: string[]): Element {
  let current: Element | null = start;
  let best = start;
  for (let i = 0; i < 14 && current; i += 1) {
    const node: Element = current;
    const hits = allNicks.filter((nick) => hasNick(node, nick));
    if (hits.length > 1) return best;
    if (hits.length === 1 && nicknamesEqual(hits[0], nickname)) best = node;
    current = node.parentElement;
  }
  return best;
}

function ownText(node: Element): string {
  return Array.from(node.childNodes)
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => (child.textContent ?? "").replace(/\s+/g, " ").trim())
    .join("");
}

function innermostName(row: Element, nickname: string): Element | undefined {
  const candidates = [
    row,
    ...row.querySelectorAll("a, span, div, p, strong, h4, h5, button"),
  ];
  let ownBest: Element | undefined;
  let textBest: Element | undefined;
  for (const node of candidates) {
    if (nicknamesEqual(ownText(node), nickname)) {
      if (!ownBest || ownBest.contains(node)) ownBest = node;
    }
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (nicknamesEqual(text, nickname)) {
      if (!textBest || textBest.contains(node)) textBest = node;
    }
  }
  return ownBest ?? textBest;
}

function injectOne(label: GameLabel, allNicks: string[]): void {
  const starts: Element[] = [];
  for (const el of deepElements(document)) {
    if (inSiteChrome(el)) continue;
    if (nameMatches(el, label.nickname)) starts.push(el);
  }
  const seen = new Set<Element>();
  for (const start of starts) {
    const row = findRow(start, label.nickname, allNicks);
    if (seen.has(row)) continue;
    seen.add(row);
    const compact = isCompactRow(row);
    const name =
      (compact
        ? scoreboardName(row, label.nickname)
        : innermostName(row, label.nickname)) ?? start;
    attachBadge(name, label, compact);
  }
}

function scrapeLines(stats: LobbyStats): ThisGameLine[] {
  const roster = [...stats.you.players, ...stats.them.players];
  const youIds = new Set(stats.you.players.map((player) => player.player_id));
  const lines: ThisGameLine[] = [];

  for (const player of roster) {
    for (const el of deepElements(document)) {
      if (inSiteChrome(el)) continue;
      if (!nameMatches(el, player.nickname)) continue;
      let row: Element | null = el;
      for (let i = 0; i < 8 && row; i += 1) {
        const text = (row.textContent ?? "").replace(/\s+/g, " ");
        if (/Last\s+\d+\s+matches/i.test(text)) break;
        const kda = text.match(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\b/);
        const kdMatch = text.match(/\b(\d+\.\d{1,2})\b(?!%)/g);
        if (kda && !/Last\s+\d+/i.test(text)) {
          const kills = Number(kda[1]);
          const deaths = Number(kda[2]);
          const assists = Number(kda[3]);
          if (kills + deaths >= 8) {
            const kd =
              kdMatch && kdMatch.length
                ? Number(kdMatch[kdMatch.length - 1])
                : deaths > 0
                  ? kills / deaths
                  : kills;
            lines.push({
              playerId: player.player_id,
              nickname: player.nickname,
              teamKey: youIds.has(player.player_id) ? "you" : "them",
              kills,
              deaths,
              assists,
              kd: Number.isFinite(kd) ? kd : deaths > 0 ? kills / deaths : kills,
              adr: null,
              won: false,
              mapKey: stats.maps.find((item) => item.class_name)?.class_name ?? "",
            });
            break;
          }
        }
        row = row.parentElement;
      }
      if (lines.some((line) => line.playerId === player.player_id)) break;
    }
  }

  if (lines.length >= 8) {
    const youBest = Math.max(
      0,
      ...lines.filter((line) => line.teamKey === "you").map((line) => line.kd),
    );
    const themBest = Math.max(
      0,
      ...lines.filter((line) => line.teamKey === "them").map((line) => line.kd),
    );
    const youWon = youBest >= themBest;
    for (const line of lines) {
      line.won = line.teamKey === "you" ? youWon : !youWon;
    }
  }
  return lines;
}

function labelsFromPage(stats: LobbyStats): GameLabel[] {
  if (stats.labels.length > 0) return stats.labels;
  if (!stats.historyGames?.length) return [];
  if (!/ongoing|live|subst|finish|complete|closed|over/i.test(stats.status ?? "")) {
    return [];
  }
  const scraped = scrapeLines(stats);
  if (scraped.length < 5) return [];
  const histories = new Map<string, PlayerHistory>();
  for (const row of stats.historyGames) {
    histories.set(row.playerId, {
      byMap: new Map(),
      matchIds: [],
      games: row.games,
      elo: null,
      eloDelta: null,
    });
  }
  return assignGameLabels(stats.matchId, scraped, histories, stats.matchAt);
}

export async function injectPlayerLabels(stats: LobbyStats): Promise<void> {
  const settings = await loadSettings();
  if (!settings.gameLabels) {
    clearPlayerLabels();
    return;
  }
  const labels = labelsFromPage(stats);
  if (labels.length === 0) {
    clearPlayerLabels();
    return;
  }
  const existing = document.querySelectorAll(`[${ATTR}]`);
  const wanted = labels.map((label) => `${label.playerId}:${label.key}:${label.detail}`);
  const seen = [...existing].map(
    (node) =>
      `${node.getAttribute(ATTR) ?? ""}:${node.getAttribute("data-fin-sig") ?? ""}`,
  );
  if (
    existing.length === wanted.length &&
    wanted.every((item) => seen.includes(item))
  ) {
    return;
  }
  ensureStyle();
  clearPlayerLabels();
  const allNicks = rosterNicks(stats);
  for (const label of labels) injectOne(label, allNicks);
}

export function clearPlayerLabels(): void {
  hideTip();
  document.querySelectorAll(`[${ATTR}]`).forEach((node) => node.remove());
  document.querySelectorAll(".fin-label-host").forEach((node) => {
    node.classList.remove("fin-label-host");
  });
}

export function observePlayerLabels(
  getStats: () => LobbyStats | undefined,
): MutationObserver {
  let timer: number | undefined;
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      if (mutation.type === "attributes") return false;
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (nodes.length === 0) return false;
      return nodes.some((node) => {
        if (!(node instanceof Element)) return true;
        return !inSiteChrome(node) && !node.closest(".fin-map-chip");
      });
    });
    if (!relevant) return;
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const stats = getStats();
      if (stats) void injectPlayerLabels(stats);
    }, 1200);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
