import { pickedMapKeys } from "../lib/briefing";
import { isThin } from "../lib/insights";
import { KNOWN_MAPS, restrictLobbyMaps } from "../lib/maps";
import { pickAdvantage } from "../lib/scoring";
import { loadSettings } from "../lib/settings";
import { applyTeamColors } from "../lib/team-colors";
import type { LobbyStats, MapEntity, TeamMapStat } from "../lib/types";

const CHIP_ATTR = "data-fin-map";
const HOST_ATTR = "data-fin-map-row";
const STYLE_ID = "faceit-numbers-map-chips";

const CHIP_CSS = `
:root {
  --fin-you: #3d8bfd;
  --fin-them: #ff5500;
  --fin-you-soft: #9ec1ff;
  --fin-them-soft: #ffb086;
}
[data-fin-map-row] {
  position: relative !important;
  overflow: visible !important;
}
.fin-map-chip {
  position: absolute;
  right: var(--fin-chip-right, 64px);
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 5px 8px 5px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(8, 10, 14, 0.88);
  box-shadow: inset 3px 0 0 #4a5160;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  z-index: 6;
}
.fin-map-chip.fin-lean-you {
  background: color-mix(in srgb, var(--fin-you, #3d8bfd) 22%, rgba(8, 10, 14, 0.88));
  border-color: color-mix(in srgb, var(--fin-you, #3d8bfd) 40%, transparent);
  box-shadow: inset 3px 0 0 var(--fin-you, #3d8bfd);
}
.fin-map-chip.fin-lean-them {
  background: color-mix(in srgb, var(--fin-them, #ff5500) 22%, rgba(8, 10, 14, 0.88));
  border-color: color-mix(in srgb, var(--fin-them, #ff5500) 40%, transparent);
  box-shadow: inset 3px 0 0 var(--fin-them, #ff5500);
}
.fin-map-chip.fin-thin {
  opacity: 0.58;
}
.fin-map-chip .fin-you,
.fin-map-chip .fin-them {
  min-width: 2.35em;
  text-align: right;
}
.fin-map-chip .fin-you { color: var(--fin-you-soft, #9ec1ff); }
.fin-map-chip .fin-them { color: var(--fin-them-soft, #ffb086); }
.fin-map-chip .fin-sep { color: #6b7380; font-weight: 500; }
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CHIP_CSS;
  document.documentElement.append(style);
}

function wrOnly(stat: TeamMapStat): string {
  if (stat.winRate == null) return "—";
  return `${Math.round(stat.winRate * 100)}%`;
}

function chipHtml(you: TeamMapStat, them: TeamMapStat): string {
  return `<span class="fin-you">${wrOnly(you)}</span><span class="fin-sep">·</span><span class="fin-them">${wrOnly(them)}</span>`;
}

function chipLean(
  you: TeamMapStat,
  them: TeamMapStat,
  adjust: boolean,
): "you" | "them" | "even" {
  const gap = pickAdvantage(you, them, adjust);
  if (gap >= 0.05) return "you";
  if (gap <= -0.05) return "them";
  return "even";
}

function chipClassName(lean: "you" | "them" | "even", thin: boolean): string {
  return ["fin-map-chip", `fin-lean-${lean}`, thin ? "fin-thin" : ""]
    .filter(Boolean)
    .join(" ");
}

function isOwnUi(node: Element): boolean {
  return Boolean(
    node.closest("#faceit-numbers-overlay") ||
      node.closest(".fin-map-chip") ||
      node.closest("header") ||
      node.closest("nav"),
  );
}

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function mapNames(entity: MapEntity): string[] {
  const names = [entity.name, entity.class_name, entity.class_name.replace(/^de_/, "")];
  if (compact(entity.name) === "dust2") names.push("Dust2", "Dust 2");
  return names;
}

function imageMatches(img: HTMLImageElement, entity: MapEntity): boolean {
  const haystack = `${img.src} ${img.alt}`.toLowerCase();
  if (haystack.includes(entity.class_name.toLowerCase())) return true;
  const alt = compact(img.alt);
  return alt !== "" && mapNames(entity).some((name) => compact(name) === alt);
}

function labelMatches(node: Element, entity: MapEntity): boolean {
  const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 24) return false;
  return mapNames(entity).some((name) => compact(name) === compact(text));
}

function containsMap(node: Element, entity: MapEntity): boolean {
  for (const img of node.querySelectorAll("img")) {
    if (imageMatches(img, entity)) return true;
  }
  if (node instanceof HTMLImageElement && imageMatches(node, entity)) return true;
  const text = compact(node.textContent ?? "");
  if (!text) return false;
  return mapNames(entity).some((name) => {
    const token = compact(name);
    return token.length >= 4 && text.includes(token);
  });
}

function isExclusiveRow(
  node: Element,
  entity: MapEntity,
  pool: MapEntity[],
): boolean {
  if (!containsMap(node, entity)) return false;
  return pool.every(
    (other) => other.class_name === entity.class_name || !containsMap(node, other),
  );
}

function canHostChip(node: Element): boolean {
  const tag = node.tagName;
  if (tag === "IMG" || tag === "SVG" || tag === "CANVAS" || tag === "PATH") {
    return false;
  }
  const rect = node.getBoundingClientRect();
  return rect.width >= 140 && rect.height >= 24 && rect.height <= 420;
}

function findMapRow(
  start: Element,
  entity: MapEntity,
  pool: MapEntity[],
): Element | undefined {
  let current: Element | null = start;
  let best: Element | undefined;
  for (let i = 0; i < 14 && current && current !== document.body; i += 1) {
    if (isOwnUi(current)) break;
    if (isExclusiveRow(current, entity, pool)) {
      if (canHostChip(current)) best = current;
    } else if (best) {
      break;
    }
    current = current.parentElement;
  }
  return best;
}

function findLabel(entity: MapEntity): Element | undefined {
  for (const node of document.querySelectorAll("span, p, div, h2, h3, h4, button, a")) {
    if (isOwnUi(node)) continue;
    if (!labelMatches(node, entity)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    return node;
  }
  return undefined;
}

function findMapCards(entities: MapEntity[]): Map<string, Element> {
  const found = new Map<string, Element>();
  const used = new Set<Element>();

  const starts = new Map<string, Element>();
  for (const img of document.querySelectorAll("img")) {
    if (isOwnUi(img)) continue;
    const rect = img.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20 || rect.width > 420) continue;
    for (const entity of entities) {
      if (starts.has(entity.class_name)) continue;
      if (!imageMatches(img, entity)) continue;
      starts.set(entity.class_name, img);
    }
  }
  for (const entity of entities) {
    if (starts.has(entity.class_name)) continue;
    const label = findLabel(entity);
    if (label) starts.set(entity.class_name, label);
  }

  for (const entity of entities) {
    const start = starts.get(entity.class_name);
    if (!start) continue;
    const row = findMapRow(start, entity, entities);
    if (!row || used.has(row)) continue;
    used.add(row);
    found.set(entity.class_name, row);
  }

  return found;
}

function cardLooksDimmed(node: Element): boolean {
  const style = getComputedStyle(node);
  const opacity = Number(style.opacity);
  if (Number.isFinite(opacity) && opacity < 0.7) return true;
  if (/grayscale\(\s*(1|100%)/i.test(style.filter)) return true;
  const img = node.querySelector("img") ?? (node instanceof HTMLImageElement ? node : null);
  if (img) {
    const filter = getComputedStyle(img).filter;
    if (/grayscale\(\s*(1|100%)/i.test(filter)) return true;
  }
  return false;
}

function looksLikeMapPicker(): boolean {
  for (const node of document.querySelectorAll("h1, h2, h3, h4, span, p, div, legend")) {
    if (isOwnUi(node)) continue;
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 60) continue;
    if (/active duty map pool/i.test(text)) return true;
    if (/^extended pool$/i.test(text)) return true;
  }
  return false;
}

function actionControl(row: Element): HTMLElement | undefined {
  for (const node of row.querySelectorAll("button, [role='button'], a")) {
    if (!(node instanceof HTMLElement) || node.closest(".fin-map-chip")) continue;
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    if (text === "BAN" || text === "PICK") return node;
  }
  return undefined;
}

function sharedChipGutter(rows: Iterable<Element>): number {
  let gutter = 56;
  for (const row of rows) {
    const action = actionControl(row);
    if (!action) continue;
    const rowRect = row.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    if (actionRect.width < 8) continue;
    gutter = Math.max(gutter, Math.ceil(rowRect.right - actionRect.left) + 8);
  }
  return gutter;
}

function placeChip(
  row: Element,
  mapKey: string,
  html: string,
  className: string,
  gutter: number,
): void {
  row.setAttribute(HOST_ATTR, mapKey);
  (row as HTMLElement).style.setProperty("--fin-chip-right", `${gutter}px`);
  const leftover = row.nextElementSibling;
  if (
    leftover instanceof HTMLElement &&
    leftover.classList.contains("fin-map-chip")
  ) {
    leftover.remove();
  }

  let chip = row.querySelector<HTMLElement>(`.fin-map-chip[${CHIP_ATTR}="${mapKey}"]`);
  if (!chip) {
    chip = document.createElement("span");
    chip.className = className;
    chip.setAttribute(CHIP_ATTR, mapKey);
    chip.innerHTML = html;
    row.append(chip);
    return;
  }
  if (chip.parentElement !== row) row.append(chip);
  if (chip.className !== className) chip.className = className;
  if (chip.innerHTML !== html) chip.innerHTML = html;
}

export async function injectMapCards(stats: LobbyStats): Promise<void> {
  if (pickedMapKeys(stats).length > 0) {
    clearMapCards();
    return;
  }
  ensureStyle();
  const cards = findMapCards(stats.maps);
  if (cards.size < 3) return;

  const settings = await loadSettings();
  applyTeamColors(document.documentElement, settings.youColor, settings.themColor);
  const keep = new Set<string>();
  const gutter = sharedChipGutter(cards.values());
  for (const [mapKey, row] of cards) {
    const you = stats.you.maps.find((item) => item.mapKey === mapKey);
    const them = stats.them.maps.find((item) => item.mapKey === mapKey);
    if (!you || !them) continue;
    keep.add(mapKey);
    const thin = settings.thinSample && (isThin(you) || isThin(them));
    placeChip(
      row,
      mapKey,
      chipHtml(you, them),
      chipClassName(chipLean(you, them, settings.adjust), thin),
      gutter,
    );
  }

  document.querySelectorAll<HTMLElement>(`.fin-map-chip[${CHIP_ATTR}]`).forEach((chip) => {
    const key = chip.getAttribute(CHIP_ATTR);
    if (!key || !keep.has(key)) chip.remove();
  });
}

export function clearMapCards(): void {
  document.querySelectorAll(`.fin-map-chip[${CHIP_ATTR}]`).forEach((node) => node.remove());
  document.querySelectorAll(`[${HOST_ATTR}]`).forEach((node) => {
    node.removeAttribute(HOST_ATTR);
    if (node instanceof HTMLElement) node.style.removeProperty("--fin-chip-right");
  });
}

export function detectVisibleMapPool(): MapEntity[] {
  const cards = findMapCards(KNOWN_MAPS);
  if (cards.size < 4) return [];
  const picker = looksLikeMapPicker();
  const selected: MapEntity[] = [];
  for (const entity of KNOWN_MAPS) {
    const root = cards.get(entity.class_name);
    if (!root) continue;
    if (picker && cardLooksDimmed(root)) continue;
    selected.push(entity);
  }
  return selected;
}

export function applyVisiblePool(stats: LobbyStats): LobbyStats {
  const detected = detectVisibleMapPool();
  if (detected.length < 4) return stats;
  return restrictLobbyMaps(stats, detected);
}

export function observeMapCards(
  getStats: () => LobbyStats | undefined,
  onStats?: (stats: LobbyStats) => void,
  onMaybePicked?: () => void,
): MutationObserver {
  let timer: number | undefined;
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      const target = mutation.target;
      if (!(target instanceof Element)) return true;
      return !isOwnUi(target);
    });
    if (!relevant) return;
    if (timer != null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const stats = getStats();
      if (!stats) return;
      const next = applyVisiblePool(stats);
      onStats?.(next);
      const cards = findMapCards(next.maps);
      if (cards.size < 3 && pickedMapKeys(next).length === 0) {
        onMaybePicked?.();
        return;
      }
      void injectMapCards(next);
    }, 800);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
