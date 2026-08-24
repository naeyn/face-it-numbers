import type {
  GameLabel,
  GameLabelKey,
  LobbyStats,
  PlayerHistory,
  RoleLabel,
  RoleLabelKey,
} from "../lib/types";
import { loadSettings } from "../lib/settings";
import { assignGameLabels } from "../lib/game-labels";
import { BANTER_ROLE_KEYS } from "../lib/role-labels";
import type { ThisGameLine } from "../lib/match-stats";

const ATTR = "data-fin-label";
const ROLE_ATTR = "data-fin-role";
const STRIP_ATTR = "data-fin-role-strip";
const STYLE_ID = "faceit-numbers-player-labels";
// Bump on ANY badge rendering change (CSS, icons, structure): the repaint
// dedup compares signatures against badges already in the DOM, which survive
// extension updates — without a version, stale badges are never redrawn.
const RENDER_VERSION = "v11";

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
/* Badge language: FORM labels = filled squares (above); ROLE pendants =
   outlined pills with an always-visible icon; pre-game brief tags in the
   overlay = dashed outlines. */
.fin-player-label.role {
  border-radius: 999px !important;
  padding: 2px 9px !important;
}
.fin-player-label.role.compact { border-radius: 999px !important; }
.fin-player-label.role.compact svg { width: 16px; height: 16px; }
.fin-player-label.role:not(.compact) svg {
  width: 15px;
  height: 15px;
  margin-right: 5px;
  flex: 0 0 15px;
  fill: currentColor;
  pointer-events: none;
}
.fin-player-label.role.good { background: rgba(158,229,158,.10) !important; color: #9ee59e !important; box-shadow: inset 0 0 0 1.5px #3f7a4c; }
.fin-player-label.role.bad { background: rgba(240,176,144,.10) !important; color: #f0b090 !important; box-shadow: inset 0 0 0 1.5px #7a4c33; }
.fin-player-label.role.info { background: rgba(158,193,255,.10) !important; color: #9ec1ff !important; box-shadow: inset 0 0 0 1.5px #3d5680; }
/* Role pendant as an avatar corner badge, like Faceit's own avatar badges */
.fin-avatar-badge-host { position: relative !important; }
.fin-player-label.role.avatar-badge {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 28px !important;
  height: 28px !important;
  margin: 0 !important;
  padding: 0 !important;
  flex: 0 0 28px !important;
  justify-content: center;
  border-radius: 999px !important;
  background: #17171b !important;
  z-index: 12;
  overflow: visible !important;
}
.fin-player-label.role.avatar-badge svg {
  width: 17px;
  height: 17px;
  display: block;
  fill: currentColor;
  pointer-events: none;
}
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
#fin-label-tip .fin-tip-scope {
  color: #78859a;
  margin-top: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
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

const ROLE_HINTS: Record<RoleLabelKey, string> = {
  humiliation: "Got knife or Zeus kills — the classic announcer award",
  clutcher: "Won multiple 1-versus-X clutch rounds",
  highlight: "Had multi-kill rounds worth rewatching",
  opener: "Entry fragger: took the round's first duel most often, and won them",
  awper: "The lobby's sniper: biggest share of kills with a sniper rifle",
  onetapper: "Cleanest aim in the lobby: highest headshot rate",
  closer: "Finished rounds: the most MVP stars, plus clutches",
  spacetaker:
    "Took the round's first duel most often, even when losing it — creates space",
  utilityking: "Dealt the most grenade damage in the lobby",
  pistoldemon: "Got a big share of their kills with pistols",
  damagedealer: "Top damage output without converting it into the most kills",
  support: "Set up teammates more than they fragged themselves",
};

const ROLE_ICON_PATHS: Record<RoleLabelKey, string> = {
  humiliation: "M2 13.5 11.5 4l2.5-2.5.5 3L5 14l-3 .5z",
  clutcher: "M8 1.5 13 3.5v4.2c0 3.1-2 5.8-5 6.8-3-1-5-3.7-5-6.8V3.5z",
  highlight: "M8 1l1.8 5.2L15 8l-5.2 1.8L8 15l-1.8-5.2L1 8l5.2-1.8z",
  opener: "M1.5 5.8h7.3V2.4L14.8 8l-6 5.6V10.2H1.5z",
  awper:
    "M7.35.2h1.3v3h-1.3zM7.35 12.8h1.3v3h-1.3zM.2 7.35h3v1.3h-3zM12.8 7.35h3v1.3h-3zM8 2.6a5.4 5.4 0 1 1 0 10.8A5.4 5.4 0 0 1 8 2.6zm0 2.1a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6zm0 1.7a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
  onetapper:
    "M8 1.6a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2zM2 14.8c0-3.3 2.7-5.1 6-5.1s6 1.8 6 5.1zM8 3.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z",
  closer: "M2.6 1h2V15h-2zM4.6 1.8h9.6l-2.6 3.4 2.6 3.4H4.6z",
  spacetaker:
    "M1 1h6.2L4.9 3.3l3.2 3.2-1.6 1.6-3.2-3.2L1 7.2zM15 15H8.8l2.3-2.3-3.2-3.2 1.6-1.6 3.2 3.2L15 8.8z",
  utilityking: "M5.8.6h4.4v2.5H5.8zM8 3.2a5.7 5.7 0 1 1 0 11.4A5.7 5.7 0 0 1 8 3.2z",
  pistoldemon:
    "M1.5 4h13v3.2H9.2l-.6 2.4c-.2.8-.7 1.2-1.5 1.2H4.6l1-3.6H3.2L1.5 5.4z",
  damagedealer:
    "M8 1.2 9.6 5l3.9-1.7-2.3 3.5 3.6 1.9-4 .6.9 4-3.7-2.2L4.3 13l.9-4-4-.6L4.8 6.5 2.5 3.3 6.4 5z",
  support: "M7 3h2v4h4v2H9v4H7V9H3V7h4z",
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

// One badge shape for both families (performance labels + role pendants) so
// tooltip, icon, and row-finding logic stay shared.
type Badge = {
  playerId: string;
  nickname: string;
  text: string;
  tone: string;
  hint: string;
  detail: string;
  scope: string;
  iconPath: string;
  attr: string;
  extraClass: string;
};

function badgeFromLabel(label: GameLabel): Badge {
  return {
    playerId: label.playerId,
    nickname: label.nickname,
    text: label.text,
    tone: label.tone,
    hint: LABEL_HINTS[label.key],
    detail: label.detail,
    scope: "Form · this game vs their previous 30 games",
    iconPath: ICON_PATHS[label.key],
    attr: ATTR,
    extraClass: "",
  };
}

function badgeFromRole(role: RoleLabel): Badge {
  return {
    playerId: role.playerId,
    nickname: role.nickname,
    text: role.text,
    tone: role.tone,
    hint: ROLE_HINTS[role.key],
    detail: role.detail,
    scope: "Role · this match only, vs the other 9 players",
    iconPath: ROLE_ICON_PATHS[role.key],
    attr: ROLE_ATTR,
    extraClass: " role",
  };
}

function hideTip(): void {
  document.getElementById(TIP_ID)?.remove();
}

function showTip(anchor: HTMLElement, badge: Badge): void {
  hideTip();
  const tip = document.createElement("div");
  tip.id = TIP_ID;
  const name = document.createElement("div");
  name.className = "fin-tip-name";
  name.textContent = badge.text;
  const hint = document.createElement("div");
  hint.className = "fin-tip-hint";
  hint.textContent = badge.hint;
  const detail = document.createElement("div");
  detail.className = "fin-tip-detail";
  detail.textContent = badge.detail;
  const scope = document.createElement("div");
  scope.className = "fin-tip-scope";
  scope.textContent = badge.scope;
  tip.append(name, hint, detail, scope);
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

// closest() cannot cross shadow boundaries — walk up through shadow hosts so
// content inside our overlay's shadow root is recognized as ours.
function inOurShadow(el: Element): boolean {
  let root = el.getRootNode();
  while (root instanceof ShadowRoot) {
    const host = root.host;
    if (host.id === "faceit-numbers-overlay" || host.closest("#faceit-numbers-overlay")) {
      return true;
    }
    root = host.getRootNode();
  }
  return false;
}

function inSiteChrome(el: Element): boolean {
  if (
    el.closest("#faceit-numbers-overlay") ||
    el.closest(".fin-player-label") ||
    el.closest(".fin-role-card-row") ||
    el.closest("#fin-label-tip") ||
    inOurShadow(el)
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

function iconFor(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", path);
  svg.append(el);
  return svg;
}

function badgeFor(badge: Badge, compact: boolean): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `fin-player-label ${badge.tone}${badge.extraClass}${compact ? " compact" : ""}`;
  span.setAttribute(badge.attr, badge.playerId);
  span.setAttribute("data-fin-sig", `${RENDER_VERSION}:${badge.text}:${badge.detail}`);
  span.setAttribute(
    "aria-label",
    `${badge.text}. ${badge.hint}. ${badge.detail}. ${badge.scope}`,
  );
  span.addEventListener("mouseenter", () => showTip(span, badge));
  span.addEventListener("mouseleave", hideTip);
  if (compact) {
    span.append(iconFor(badge.iconPath));
  } else if (badge.attr === ROLE_ATTR) {
    // Role pendants always carry their icon — part of the visual language
    // separating them from the filled form labels.
    span.append(iconFor(badge.iconPath), document.createTextNode(badge.text));
  } else {
    span.textContent = badge.text;
  }
  return span;
}

function alreadyLabeled(node: Element, badge: Badge): boolean {
  const parent = node.parentElement;
  if (parent?.querySelector(`[${badge.attr}="${badge.playerId}"]`)) return true;
  if (node.nextElementSibling?.getAttribute(badge.attr) === badge.playerId) return true;
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

function attachBadge(node: Element, badge: Badge, compact: boolean): void {
  if (alreadyLabeled(node, badge)) return;
  // A role pill sits after the form chip when the player has both.
  const sibling = node.nextElementSibling;
  const anchor =
    badge.attr === ROLE_ATTR && sibling?.getAttribute(ATTR) === badge.playerId
      ? sibling
      : node;
  anchor.after(badgeFor(badge, compact));
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

function injectOne(badge: Badge, allNicks: string[]): void {
  const starts: Element[] = [];
  for (const el of deepElements(document)) {
    if (inSiteChrome(el)) continue;
    if (nameMatches(el, badge.nickname)) starts.push(el);
  }
  const seen = new Set<Element>();
  for (const start of starts) {
    const row = findRow(start, badge.nickname, allNicks);
    if (seen.has(row)) continue;
    seen.add(row);
    const compact = isCompactRow(row);
    const name =
      (compact
        ? scoreboardName(row, badge.nickname)
        : innermostName(row, badge.nickname)) ?? start;
    attachBadge(name, badge, compact);
  }
}

// ---- Role avatar badges: the pendant overlays the top-right corner of the
// player's avatar on the big cards, like Faceit's own avatar badges.

// Largest square-ish visual in the card is the avatar (pierces shadow DOM,
// accepts imgs, canvases, and background-image divs; skips tiny flag icons).
function findAvatar(card: Element): Element | undefined {
  let best: Element | undefined;
  let bestArea = 0;
  const candidates: Element[] = card instanceof Element ? [card] : [];
  for (const el of [...candidates, ...deepElements(card)]) {
    let visual = el.tagName === "IMG" || el.tagName === "CANVAS" || el.tagName === "VIDEO";
    if (!visual && el instanceof HTMLElement) {
      const bg = getComputedStyle(el).backgroundImage;
      visual = !!bg && bg !== "none";
    }
    if (!visual) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) continue;
    if (rect.width > 240 || rect.height > 320) continue; // banners, map art
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

// The visible avatar frame is the outermost ancestor that is still sized
// like the avatar block (photo + padding), not the whole card row. Anchoring
// there keeps the badge on the frame corner whether the artwork fills the
// frame (custom card skins) or sits smaller inside it (round photos).
function avatarFrame(avatar: Element, card: Element): HTMLElement | undefined {
  const aRect = avatar.getBoundingClientRect();
  let frame: HTMLElement | undefined = avatar.parentElement ?? undefined;
  let current: HTMLElement | null = avatar.parentElement;
  while (current && current !== card) {
    const rect = current.getBoundingClientRect();
    if (rect.width > aRect.width + 56 || rect.height > aRect.height + 72) break;
    frame = current;
    current = current.parentElement;
  }
  return frame;
}

function injectRoleAvatarBadge(role: RoleLabel, allNicks: string[]): void {
  const badge = badgeFromRole(role);
  const seen = new Set<Element>();
  for (const el of deepElements(document)) {
    if (inSiteChrome(el)) continue;
    if (!nameMatches(el, role.nickname)) continue;
    const card = findRow(el, role.nickname, allNicks);
    if (seen.has(card)) continue;
    seen.add(card);
    if (isCompactRow(card)) continue; // big player cards only
    if (card.querySelector(`[${ROLE_ATTR}="${role.playerId}"]`)) continue;
    const avatar = findAvatar(card);
    const host = avatar?.parentElement;
    const host = avatar?.parentElement;
    if (host && avatar) {
      host.classList.add("fin-avatar-badge-host");
      const span = badgeFor(badge, true);
      span.classList.add("avatar-badge");
      // Append to the avatar's parent (a containing block that provably
      // positions correctly) but aim the offsets at the visible frame's
      // rect, so full-bleed card skins and small round photos land on the
      // same corner.
      const frame = avatarFrame(avatar, card);
      const frameRect = frame?.getBoundingClientRect();
      const target =
        frameRect && frameRect.width > 0 ? frameRect : avatar.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      span.style.top = `${Math.round(target.top - hostRect.top) - 9}px`;
      span.style.right = `${Math.round(hostRect.right - target.right) - 9}px`;
      host.append(span);
    } else {
      // No avatar found in this card structure — fall back to an inline
      // pill next to the name so the role is never silently dropped.
      console.debug("[fin] role badge: no avatar host for", role.nickname);
      const name = innermostName(card, role.nickname);
      if (name) attachBadge(name, badge, false);
    }
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
  const inline: Badge[] = settings.gameLabels
    ? labelsFromPage(stats).map(badgeFromLabel)
    : [];
  const roles: RoleLabel[] = settings.roleLabels
    ? (stats.roles ?? []).filter(
        (role) => settings.banterLabels || !BANTER_ROLE_KEYS.has(role.key),
      )
    : [];
  const badges = [...inline, ...roles.map(badgeFromRole)];
  if (badges.length === 0) {
    clearPlayerLabels();
    return;
  }
  const existing = document.querySelectorAll(`[${ATTR}], [${ROLE_ATTR}]`);
  const wanted = badges.map(
    (badge) =>
      `${badge.attr}:${badge.playerId}:${RENDER_VERSION}:${badge.text}:${badge.detail}`,
  );
  const seen = [...existing].map((node) => {
    const attr = node.hasAttribute(ATTR) ? ATTR : ROLE_ATTR;
    return `${attr}:${node.getAttribute(attr) ?? ""}:${node.getAttribute("data-fin-sig") ?? ""}`;
  });
  if (
    existing.length === wanted.length &&
    wanted.every((item) => seen.includes(item))
  ) {
    return;
  }
  ensureStyle();
  clearPlayerLabels();
  const allNicks = rosterNicks(stats);
  for (const badge of inline) injectOne(badge, allNicks);
  for (const role of roles) injectRoleAvatarBadge(role, allNicks);
}

export function clearPlayerLabels(): void {
  hideTip();
  document
    .querySelectorAll(`[${ATTR}], [${ROLE_ATTR}], [${STRIP_ATTR}]`)
    .forEach((node) => node.remove());
  document.querySelectorAll(".fin-label-host").forEach((node) => {
    node.classList.remove("fin-label-host");
  });
  document.querySelectorAll(".fin-card-host").forEach((node) => {
    node.classList.remove("fin-card-host");
  });
  document.querySelectorAll(".fin-avatar-badge-host").forEach((node) => {
    node.classList.remove("fin-avatar-badge-host");
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
