import type {
  GameLabel,
  LobbyStats,
  PlayerHistory,
  RoleLabel,
} from "../lib/types";
import { loadSettings } from "../lib/settings";
import {
  ATTR,
  badgeElement,
  badgeFromLabel,
  badgeFromRole,
  badgeFromStreak,
  hideTip,
  LABEL_CSS,
  RENDER_VERSION,
  ROLE_ATTR,
  showTip,
  STREAK_ATTR,
  type Badge,
  type StreakEntry,
} from "./badge-art";
import { assignGameLabels, sameMatchId } from "../lib/game-labels";
import { currentStreak } from "../lib/insights";
import { STREAK_MIN } from "../lib/constants";
import { BANTER_ROLE_KEYS } from "../lib/role-labels";
import type { ThisGameLine } from "../lib/match-stats";

const STRIP_ATTR = "data-fin-role-strip";
const STYLE_ID = "faceit-numbers-player-labels";

function ensureStyle(): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.documentElement.append(style);
  }
  style.textContent = LABEL_CSS;
}

// A badge animates in ONCE per player per match. `injectPlayerLabels` wipes
// and re-injects every badge whenever any one of them changes, and the
// MutationObserver re-runs on a 1.2s debounce, so without this an unrelated
// form-label update would re-pop every streak badge on the page.
const animated = new Set<string>();
let animatedMatch = "";
let entering = new Set<string>();

function entryKey(badge: Badge): string {
  return `${badge.attr}:${badge.playerId}`;
}

function badgeFor(badge: Badge, compact: boolean): HTMLSpanElement {
  const span = badgeElement(badge, compact);
  span.addEventListener("mouseenter", () => showTip(span, badge));
  span.addEventListener("mouseleave", hideTip);
  if (entering.has(entryKey(badge))) {
    span.classList.add("fin-enter");
    // Marked here, not up front: a badge whose row is not in the DOM yet
    // never renders, and should still animate when the row does appear.
    // Within one pass `entering` still holds the key, so a player shown on
    // two rows animates on both.
    animated.add(entryKey(badge));
    // Capped stagger: ten badges read as one sweep, a full scoreboard still
    // settles inside half a second.
    span.style.animationDelay = `${Math.min(badge.order, 9) * 40}ms`;
  }
  return span;
}

// Lobby intel only: once the match starts, the slot next to the name belongs
// to the form labels, so the streak badge stands down. Same status set the
// background uses to decide that game labels are not computable yet.
const PRE_MATCH = /vot|ready|config|created|sched|check/i;

function streakEntries(stats: LobbyStats): StreakEntry[] {
  if (!PRE_MATCH.test(stats.status ?? "")) return [];
  const entries: StreakEntry[] = [];
  for (const row of stats.historyGames ?? []) {
    // Sort and filter once, then let both the streak and the tooltip form
    // string read the same array — currentStreak would otherwise redo it.
    const recent = [...row.games]
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .filter((game) => !(game.matchId && sameMatchId(game.matchId, stats.matchId)));
    const streak = currentStreak(recent);
    if (!streak || streak.len < STREAK_MIN) continue;
    entries.push({
      playerId: row.playerId,
      nickname: row.nickname,
      streak,
      form: recent.slice(0, 10).map((game) => game.won),
    });
  }
  return entries;
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

/**
 * Faceit prints a player's name and avatar well outside the roster: the match
 * highlights and commendations carousels, the MVP and accolade cards, and
 * every line of match chat. scanRoster matches on the name alone, so all of
 * those looked like places a badge belonged.
 *
 * It reads worst on the highlight reel, and not by accident — role pendants
 * deliberately seek out big player cards, and once a room finishes the only
 * big cards left on the page are these. A badge is a claim about someone in
 * this match's roster, so keep it to the roster and the scoreboard.
 *
 * Matched on the component name rather than the generated hash next to it:
 * `styles__MvpCardHolder-sc-…` keeps its name across deploys and churns the
 * suffix. Verified none of these contain the scoreboard table.
 */
const NON_ROSTER_SURFACES = [
  "Highlight",
  "Commendation",
  "Mvp",
  "Accolade",
  "MessageContainer",
  "MessageListItem",
  "Draggable",
  "Swiper",
]
  .map((name) => `[class*="${name}"]`)
  .join(",");

function inNonRosterSurface(el: Element): boolean {
  return Boolean(el.closest(NON_ROSTER_SURFACES));
}

function* deepElements(root: ParentNode): Generator<Element> {
  const list = root.querySelectorAll("*");
  for (const el of list) {
    yield el;
    if (el.shadowRoot) yield* deepElements(el.shadowRoot);
  }
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
  // Fixed order along the row: form label, then streak, then role pill — so
  // walk past any sibling badge of a family that sorts ahead of this one.
  const precede =
    badge.attr === ROLE_ATTR
      ? [ATTR, STREAK_ATTR]
      : badge.attr === STREAK_ATTR
        ? [ATTR]
        : [];
  let anchor = node;
  while (precede.length > 0) {
    const next = anchor.nextElementSibling;
    if (!next) break;
    if (!precede.some((attr) => next.getAttribute(attr) === badge.playerId)) break;
    anchor = next;
  }
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

function nickKey(nickname: string): string {
  return nickname.trim().toLowerCase();
}

// Every element that matched SOME roster nickname, bucketed by that nickname
// and kept in document order.
type Roster = Map<string, Element[]>;

// One pass for the whole roster, instead of one pass per badge. The two costs
// in a pass do not depend on which badge is being placed: `inSiteChrome` is
// five closest() walks plus a rect read, and the text test concatenates a
// container's entire subtree. Scanning per badge re-paid both ten-odd times
// and — worse — interleaved those rect reads with badge insertions, so every
// badge after the first forced a synchronous relayout. Scan once, place after.
function scanRoster(nicknames: string[]): Roster {
  const buckets: Roster = new Map();
  for (const nickname of nicknames) buckets.set(nickKey(nickname), []);
  const keys = [...buckets.keys()];
  if (keys.length === 0) return buckets;
  for (const el of deepElements(document)) {
    if (inSiteChrome(el) || inNonRosterSurface(el)) continue;
    const href = el.getAttribute("href") ?? "";
    const fromHref = href ? nickFromHref(href) : undefined;
    const hrefKey = fromHref ? nickKey(fromHref) : undefined;
    const textKey = nickKey((el.textContent ?? "").replace(/\s+/g, " "));
    for (const key of keys) {
      // Same predicate as nameMatches, with the per-element half hoisted out.
      if (key === hrefKey || key === textKey) buckets.get(key)!.push(el);
    }
  }
  return buckets;
}

function startsFor(roster: Roster, nickname: string): Element[] {
  return roster.get(nickKey(nickname)) ?? [];
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

// A resolved target: which element a badge goes next to. Produced in the read
// phase, consumed in the write phase — nothing here touches the DOM.
type Placement = { badge: Badge; node: Element; compact: boolean };

function planOne(badge: Badge, allNicks: string[], roster: Roster): Placement[] {
  const seen = new Set<Element>();
  const placements: Placement[] = [];
  for (const start of startsFor(roster, badge.nickname)) {
    const row = findRow(start, badge.nickname, allNicks);
    if (seen.has(row)) continue;
    seen.add(row);
    const compact = isCompactRow(row);
    const name =
      (compact
        ? scoreboardName(row, badge.nickname)
        : innermostName(row, badge.nickname)) ?? start;
    placements.push({ badge, node: name, compact });
  }
  return placements;
}

// ---- Role avatar badges: the pendant overlays the top-right corner of the
// player's avatar on the big cards, like Faceit's own avatar badges.

const BADGE_SIZE = 28;
const BADGE_OVERHANG = 6;

// Largest square-ish visual in the card is the avatar artwork — the only
// element that has proven to measure reliably in Faceit's DOM. (The
// styles__PlayerCard div is an empty zero-size decorative layer.)
function findAvatar(card: Element): Element | undefined {
  let best: Element | undefined;
  let bestArea = 0;
  for (const el of deepElements(card)) {
    let visual =
      el.tagName === "IMG" || el.tagName === "CANVAS" || el.tagName === "VIDEO";
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

// Absolute positioning resolves against whatever containing block the DOM
// gives us (styled-components wrappers may be display:contents or have
// transforms), so don't trust CSS offsets: measure the target's rendered
// rect against the badge's actual offsetParent and pin in pixels.
function pinToCorner(span: HTMLElement, target: Element): void {
  const op = span.offsetParent;
  if (!(op instanceof HTMLElement)) return; // keep CSS defaults
  const targetRect = target.getBoundingClientRect();
  const opRect = op.getBoundingClientRect();
  if (targetRect.width === 0 || opRect.width === 0) return;
  span.style.top = `${Math.round(targetRect.top - opRect.top) - BADGE_OVERHANG}px`;
  span.style.left = `${Math.round(targetRect.right - opRect.left) - BADGE_SIZE + BADGE_OVERHANG}px`;
  span.style.right = "auto";
}

// The visible avatar frame: nearest ancestor that actually PAINTS a box
// (background color or border-radius) and still contains the artwork —
// detected by computed style, not DOM structure, because Faceit's wrappers
// include zero-size and display:contents layers.
function visibleFrame(avatar: Element, card: Element): Element | undefined {
  const aRect = avatar.getBoundingClientRect();
  let current = avatar.parentElement;
  while (current && current !== card) {
    const rect = current.getBoundingClientRect();
    if (rect.width > 260 || rect.height > 340) break; // reached row-scale boxes
    const style = getComputedStyle(current);
    const bg = style.backgroundColor;
    const paintsBg = !!bg && bg !== "transparent" && !bg.replace(/\s/g, "").endsWith(",0)");
    const rounded = parseFloat(style.borderRadius) > 0;
    if (
      (paintsBg || rounded) &&
      rect.width >= aRect.width - 2 &&
      rect.height >= aRect.height - 2
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return undefined;
}

// An avatar pendant that has found its card, its host, and the box it pins to.
// `pinToCorner` still runs in the write phase — it has to read the span's own
// offsetParent — but it is deferred until every insertion is done, so the whole
// batch costs one relayout instead of one per pendant.
type AvatarPlacement = {
  badge: Badge;
  card: Element;
  host: Element;
  anchor: Element;
};

type RolePlan = { avatars: AvatarPlacement[]; inline: Placement[] };

function planRoleAvatarBadge(
  role: RoleLabel,
  allNicks: string[],
  roster: Roster,
): RolePlan {
  // Rebuilt per role rather than reusing the ordered badge from the caller,
  // which is what the previous per-role pass did: avatar pendants keep
  // order 0 and enter together, they do not join the row-badge stagger.
  const badge = badgeFromRole(role);
  const plan: RolePlan = { avatars: [], inline: [] };
  const seen = new Set<Element>();
  for (const el of startsFor(roster, role.nickname)) {
    const card = findRow(el, role.nickname, allNicks);
    if (seen.has(card)) continue;
    seen.add(card);
    if (isCompactRow(card)) continue; // big player cards only
    const avatar = findAvatar(card);
    // The avatar's own card: the PlayerCardContainer frame. Its visible
    // outline (which pokes above the player row) is the styles__PlayerCard
    // overlay INSIDE it — an empty absolutely-positioned layer, so it is a
    // sibling of the artwork, not an ancestor. Pin to that when it has a
    // real rect; the container is the fallback.
    const container = avatar?.closest('[class*="PlayerCardContainer"]');
    let anchor: Element | undefined =
      container ?? (avatar ? visibleFrame(avatar, card) ?? avatar : undefined);
    const frameLayer = container?.querySelector('[class*="PlayerCard-sc"]');
    if (frameLayer) {
      const rect = frameLayer.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) anchor = frameLayer;
    }
    const host = container instanceof HTMLElement ? container : avatar?.parentElement;
    if (host && anchor) {
      plan.avatars.push({ badge, card, host, anchor });
    } else {
      const name = innermostName(card, role.nickname);
      if (name) plan.inline.push({ badge, node: name, compact: false });
    }
  }
  return plan;
}

// Returns the inserted span so the caller can pin it once all writes are done.
function attachAvatarBadge(placement: AvatarPlacement): HTMLElement | undefined {
  const { badge, card, host } = placement;
  if (card.querySelector(`[${ROLE_ATTR}="${badge.playerId}"]`)) return undefined;
  host.classList.add("fin-avatar-badge-host");
  const span = badgeFor(badge, true);
  span.classList.add("avatar-badge");
  host.append(span);
  return span;
}

function scrapeLines(stats: LobbyStats): ThisGameLine[] {
  const players = [...stats.you.players, ...stats.them.players];
  const youIds = new Set(stats.you.players.map((player) => player.player_id));
  const lines: ThisGameLine[] = [];
  // Read-only, and runs before any badge is inserted, so it can share the
  // same single pass rather than re-walking the document per player.
  const roster = scanRoster(players.map((player) => player.nickname));

  for (const player of players) {
    for (const el of startsFor(roster, player.nickname)) {
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
  const streaks: Badge[] = settings.streakLabels
    ? streakEntries(stats).map(badgeFromStreak)
    : [];
  const badges = [...inline, ...streaks, ...roles.map(badgeFromRole)];
  badges.forEach((badge, index) => {
    badge.order = index;
  });
  if (badges.length === 0) {
    clearPlayerLabels();
    return;
  }
  const existing = document.querySelectorAll(
    `[${ATTR}], [${STREAK_ATTR}], [${ROLE_ATTR}]`,
  );
  const wanted = badges.map(
    (badge) =>
      `${badge.attr}:${badge.playerId}:${RENDER_VERSION}:${badge.text}:${badge.detail}`,
  );
  const seen = new Set([...existing].map((node) => {
    const attr = node.hasAttribute(ATTR)
      ? ATTR
      : node.hasAttribute(STREAK_ATTR)
        ? STREAK_ATTR
        : ROLE_ATTR;
    return `${attr}:${node.getAttribute(attr) ?? ""}:${node.getAttribute("data-fin-sig") ?? ""}`;
  }));
  if (
    existing.length === wanted.length &&
    wanted.every((item) => seen.has(item))
  ) {
    return;
  }
  ensureStyle();
  clearPlayerLabels();
  if (stats.matchId !== animatedMatch) {
    animatedMatch = stats.matchId;
    animated.clear();
  }
  entering = new Set(
    badges.map(entryKey).filter((key) => !animated.has(key)),
  );
  const allNicks = rosterNicks(stats);
  const roster = scanRoster(allNicks);
  // Reads first: resolve every badge's target — which involves rect reads via
  // isCompactRow and findAvatar — before anything is inserted, so no insertion
  // can invalidate a measurement taken for a later badge.
  const inlinePlan = inline.flatMap((badge) => planOne(badge, allNicks, roster));
  const streakPlan = streaks.flatMap((badge) => planOne(badge, allNicks, roster));
  const rolePlans = roles.map((role) => planRoleAvatarBadge(role, allNicks, roster));
  // Writes second, in family order: attachBadge walks past sibling badges of
  // families that sort ahead of it, so form labels must land before streaks and
  // streaks before role pills for the row order to come out right.
  for (const item of inlinePlan) attachBadge(item.node, item.badge, item.compact);
  for (const item of streakPlan) attachBadge(item.node, item.badge, item.compact);
  const pins: Array<[HTMLElement, Element]> = [];
  for (const plan of rolePlans) {
    for (const item of plan.avatars) {
      const span = attachAvatarBadge(item);
      if (span) pins.push([span, item.anchor]);
    }
    for (const item of plan.inline) attachBadge(item.node, item.badge, false);
  }
  // Pinning reads geometry again, so it goes last: the first pin flushes one
  // relayout covering every insertion above, the rest read a clean tree.
  for (const [span, anchor] of pins) pinToCorner(span, anchor);
  entering = new Set();
}

export function clearPlayerLabels(): void {
  hideTip();
  document
    .querySelectorAll(`[${ATTR}], [${STREAK_ATTR}], [${ROLE_ATTR}], [${STRIP_ATTR}]`)
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
