import type { GameLabel, GameLabelKey, RoleLabel, RoleLabelKey } from "../lib/types";
import { formatForm, type Streak } from "../lib/insights";

// The badge ART layer: every rule about how a badge LOOKS — CSS, icon
// geometry, copy, markup — with no dependency on Faceit's DOM, the roster
// scan, or the extension APIs. player-labels.ts decides WHICH badges to show
// and where to attach them; this file decides what they look like. Keeping
// the seam here is what lets preview/ render the real thing instead of a
// copy that drifts.

export const ATTR = "data-fin-label";
export const ROLE_ATTR = "data-fin-role";
export const STREAK_ATTR = "data-fin-streak";
// Bump on ANY badge rendering change (CSS, icons, structure): the repaint
// dedup compares signatures against badges already in the DOM, which survive
// extension updates — without a version, stale badges are never redrawn.
export const RENDER_VERSION = "v25";

export const LABEL_CSS = `
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
/* Career (Leetify-sourced) pendants: Leetify brand gradient ring
   (their --primary #f84982 to --purple #6f42c1) */
.fin-player-label.role.career {
  box-sizing: border-box;
  border: 2px solid transparent !important;
  background:
    linear-gradient(#17171b, #17171b) padding-box,
    linear-gradient(135deg, #f84982, #6f42c1) border-box !important;
  box-shadow: none !important;
}
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
/* Must outrank .avatar-badge's solid background (same importance, later rule) */
.fin-player-label.role.avatar-badge.career {
  box-sizing: border-box;
  border: 2px solid transparent !important;
  background:
    linear-gradient(#17171b, #17171b) padding-box,
    linear-gradient(135deg, #f84982, #6f42c1) border-box !important;
  box-shadow: none !important;
}
/* STREAK badges: solid fill like a form label, but icon + digit — the only
   family pairing an icon with text on a solid background. Lobby-only, so it
   never shares a row with a form label. */
.fin-player-label.streak {
  gap: 3px;
  padding: 2px 7px 2px 5px !important;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}
.fin-player-label.streak svg {
  width: 12px;
  height: 12px;
  display: block;
  fill: currentColor;
  pointer-events: none;
}
/* Compact rows pin badges to a 22px square; a digit needs the width back. */
.fin-player-label.streak.compact {
  width: auto !important;
  height: 20px !important;
  flex: 0 0 auto !important;
  padding: 0 6px 0 4px !important;
}
.fin-player-label.streak.compact svg { width: 12px; height: 12px; }
/* One-shot entry, transform/opacity only: these badges live in Faceit's DOM,
   so anything that invalidates layout or paint does so in THEIR tree. The
   class is applied once per player per match (see the entering set) — a repaint
   triggered by some other badge changing must not replay it. */
.fin-player-label.fin-enter {
  animation: fin-badge-in 180ms cubic-bezier(.2, .9, .3, 1.2) both;
}
@keyframes fin-badge-in {
  from { opacity: 0; transform: scale(.8); }
  to { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .fin-player-label.fin-enter { animation: none; }
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

export const LABEL_HINTS: Record<GameLabelKey, string> = {
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

export const ROLE_HINTS: Record<RoleLabelKey, string> = {
  humiliation: "Got knife or Zeus kills — the classic announcer award",
  clutcher: "Won multiple 1-versus-X clutch rounds",
  highlight: "Racks up multi-kill rounds game after game",
  opener: "Entry fragger: took the round's first duel most often, and won them",
  awper: "The lobby's sniper: biggest share of kills with a sniper rifle",
  onetapper: "Cleanest aim in the lobby: highest headshot rate in recent games",
  closer: "Finishes rounds: earns the most MVP stars in recent games",
  spacetaker:
    "Took the round's first duel most often, even when losing it — creates space",
  utilityking: "Dealt the most grenade damage in the lobby",
  pistoldemon: "Got a big share of their kills with pistols",
  damagedealer: "Consistently top damage output without the top K/D",
  support: "Sets up teammates more than they frag themselves",
  trader: "Reliably trades fallen teammates — career data via Leetify",
  flashsupport: "Their flashbangs actually blind people — career data via Leetify",
  crosshair: "Best crosshair placement among Leetify-tracked players here",
  spray: "Best spray control among Leetify-tracked players here",
  reflexes: "Fastest reaction time among Leetify-tracked players here",
  sided: "Performs much better on one side of the map — via Leetify",
};

export const ROLE_ICON_PATHS: Record<RoleLabelKey, string> = {
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
  trader: "M2 4.2h8V1.8L14.6 6 10 10.2V7.8H2zM14 11.8H6v2.4L1.4 10 6 5.8v2.4h8z",
  flashsupport:
    "M8 5.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM7.4 0h1.2v3.2H7.4zM7.4 12.8h1.2V16H7.4zM0 7.4h3.2v1.2H0zM12.8 7.4H16v1.2h-3.2zM2.2 3.1l.9-.9 2.2 2.2-.9.9zM10.7 11.6l.9-.9 2.2 2.2-.9.9zM13 2.2l.9.9-2.2 2.2-.9-.9zM4.4 10.7l.9.9-2.2 2.2-.9-.9z",
  crosshair:
    "M7.4 1h1.2v3H7.4zM7.4 12h1.2v3H7.4zM1 7.4h3v1.2H1zM12 7.4h3v1.2h-3zM8 5.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z",
  spray:
    "M3 3.2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM13 9.8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM5.5 11a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM10.5 2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z",
  reflexes: "M9.2 1.2 3.8 8.6h3.7l-.9 6.2 6.2-8.6H9.1l1.1-5z",
  sided: "M8 1.5 13 3.5v4.2c0 3.1-2 5.8-5 6.8V1.5z",
};

export const ICON_PATHS: Record<GameLabelKey, string> = {
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

// Stacked chevrons: rising for a win run, falling for a loss run.
export const STREAK_ICONS = {
  up: "M8 1.2 L13.6 6.8 L11.9 8.5 L8 4.6 L4.1 8.5 L2.4 6.8 Z M8 7.4 L13.6 13 L11.9 14.7 L8 10.8 L4.1 14.7 L2.4 13 Z",
  down: "M8 14.8 L13.6 9.2 L11.9 7.5 L8 11.4 L4.1 7.5 L2.4 9.2 Z M8 8.6 L13.6 3 L11.9 1.3 L8 5.2 L4.1 1.3 L2.4 3 Z",
};

// One badge shape for both families (performance labels + role pendants) so
// tooltip, icon, and row-finding logic stay shared.
export type Badge = {
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
  order: number;
};

export function iconFor(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", path);
  svg.append(el);
  return svg;
}

export function badgeElement(badge: Badge, compact: boolean): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `fin-player-label ${badge.tone}${badge.extraClass}${compact ? " compact" : ""}`;
  span.setAttribute(badge.attr, badge.playerId);
  span.setAttribute("data-fin-sig", `${RENDER_VERSION}:${badge.text}:${badge.detail}`);
  span.setAttribute(
    "aria-label",
    `${badge.text}. ${badge.hint}. ${badge.detail}. ${badge.scope}`,
  );
  if (badge.attr === STREAK_ATTR) {
    // Always icon + digit: the count is the whole point, so this family opts
    // out of the icon-only compact treatment.
    span.append(iconFor(badge.iconPath), document.createTextNode(badge.text));
  } else if (compact) {
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

export function badgeFromLabel(label: GameLabel): Badge {
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
    order: 0,
  };
}

export function badgeFromRole(role: RoleLabel): Badge {
  const career = role.source === "leetify";
  return {
    playerId: role.playerId,
    nickname: role.nickname,
    text: role.text,
    tone: role.tone,
    hint: ROLE_HINTS[role.key],
    detail: role.detail,
    scope: career
      ? "Role · career data provided by Leetify"
      : "Role · tendency from their recent matches, vs this lobby",
    iconPath: ROLE_ICON_PATHS[role.key],
    attr: ROLE_ATTR,
    extraClass: career ? " role career" : " role",
    order: 0,
  };
}

export type StreakEntry = {
  playerId: string;
  nickname: string;
  streak: Streak;
  form: boolean[];
};

export function badgeFromStreak(entry: StreakEntry): Badge {
  const { streak } = entry;
  return {
    playerId: entry.playerId,
    nickname: entry.nickname,
    text: `${streak.won ? "W" : "L"}${streak.len}`,
    tone: streak.won ? "hot" : "cold",
    hint: streak.won
      ? `Has won their last ${streak.len} in a row`
      : `Has lost their last ${streak.len} in a row`,
    detail: `${formatForm(entry.form)} · newest first`,
    scope: "Streak · all maps, going into this match",
    iconPath: streak.won ? STREAK_ICONS.up : STREAK_ICONS.down,
    attr: STREAK_ATTR,
    extraClass: " streak",
    order: 0,
  };
}

export function hideTip(): void {
  document.getElementById(TIP_ID)?.remove();
}

export function showTip(anchor: HTMLElement, badge: Badge): void {
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
