import { shortLabel } from "../lib/maps";
import { isThin, type ChartBadge } from "../lib/insights";
import { displayWinRate, pickAdvantage } from "../lib/scoring";
import type { TeamMapStat } from "../lib/types";

export type ChartRow = {
  mapKey: string;
  displayName: string;
  dropped: boolean;
  picked: boolean;
  you: TeamMapStat;
  them: TeamMapStat;
  badge?: ChartBadge;
  thin?: boolean;
};

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function barHeight(winRate: number | null, maxBar: number): number {
  if (winRate == null) return 4;
  return Math.max(4, winRate * maxBar);
}

function wrInBar(
  group: SVGGElement,
  x: number,
  barTop: number,
  barH: number,
  rate: number | null,
  thin: boolean,
): void {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const inside = barH >= 16;
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(inside ? barTop + 11 : barTop - 2));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", inside ? "#fff" : thin ? "#c90" : "#ddd");
  text.setAttribute("font-size", "8");
  text.setAttribute("font-weight", "800");
  text.style.pointerEvents = "none";
  text.textContent = pct(rate).replace("%", "");
  group.append(text);
}

function badgeLabel(badge: ChartBadge): { text: string; fill: string } | undefined {
  if (badge === "ban") return { text: "BAN", fill: "#e07070" };
  if (badge === "perm-you") return { text: "PERM", fill: "#ff5500" };
  if (badge === "perm-them") return { text: "THEIRS", fill: "#3d8bfd" };
  return undefined;
}

export function renderChart(
  rows: ChartRow[],
  selectedMap: string | undefined,
  onSelect: (mapKey: string) => void,
  adjust = false,
): SVGSVGElement {
  const width = 380;
  const height = 228;
  const padLeft = 24;
  const padBottom = 22;
  const padTop = 36;
  const plotH = height - padTop - padBottom;
  const plotW = width - padLeft - 8;
  const groupW = plotW / Math.max(rows.length, 1);
  const barW = Math.min(18, Math.max(12, groupW * 0.36));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Team map win rates");

  const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axis.setAttribute("x1", String(padLeft));
  axis.setAttribute("x2", String(width - 4));
  axis.setAttribute("y1", String(padTop + plotH));
  axis.setAttribute("y2", String(padTop + plotH));
  axis.setAttribute("stroke", "#444");
  svg.append(axis);

  for (const tick of [0, 0.5, 1]) {
    const y = padTop + plotH - tick * plotH;
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", "2");
    label.setAttribute("y", String(y + 3));
    label.setAttribute("fill", "#888");
    label.setAttribute("font-size", "9");
    label.textContent = `${tick * 100}`;
    svg.append(label);
  }

  rows.forEach((row, index) => {
    const cx = padLeft + groupW * (index + 0.5);
    const youRate = displayWinRate(row.you, adjust);
    const themRate = displayWinRate(row.them, adjust);
    const youH = barHeight(youRate, plotH);
    const themH = barHeight(themRate, plotH);
    const selected = selectedMap === row.mapKey;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.style.cursor = "pointer";
    if (row.dropped) group.setAttribute("opacity", "0.35");
    group.addEventListener("click", () => onSelect(row.mapKey));

    if (selected || row.picked) {
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("x", String(cx - groupW / 2 + 2));
      bg.setAttribute("y", "4");
      bg.setAttribute("width", String(groupW - 4));
      bg.setAttribute("height", String(plotH + padTop + 12));
      bg.setAttribute("fill", selected ? "rgba(255,85,0,0.12)" : "rgba(255,255,255,0.04)");
      bg.setAttribute("rx", "4");
      group.append(bg);
    }

    const meta = row.badge ? badgeLabel(row.badge) : undefined;
    if (meta) {
      const tag = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tag.setAttribute("x", String(cx));
      tag.setAttribute("y", "12");
      tag.setAttribute("text-anchor", "middle");
      tag.setAttribute("font-size", "8");
      tag.setAttribute("font-weight", "800");
      tag.setAttribute("letter-spacing", "0.04em");
      tag.setAttribute("fill", meta.fill);
      tag.textContent = meta.text;
      group.append(tag);
    }

    const youBar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    youBar.setAttribute("x", String(cx - barW - 2));
    youBar.setAttribute("y", String(padTop + plotH - youH));
    youBar.setAttribute("width", String(barW));
    youBar.setAttribute("height", String(youH));
    youBar.setAttribute("fill", "#ff5500");
    youBar.setAttribute("rx", "2");
    if (!row.dropped && isThin(row.you)) youBar.setAttribute("opacity", "0.4");
    group.append(youBar);

    const themBar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    themBar.setAttribute("x", String(cx + 2));
    themBar.setAttribute("y", String(padTop + plotH - themH));
    themBar.setAttribute("width", String(barW));
    themBar.setAttribute("height", String(themH));
    themBar.setAttribute("fill", "#3d8bfd");
    themBar.setAttribute("rx", "2");
    if (!row.dropped && isThin(row.them)) themBar.setAttribute("opacity", "0.4");
    group.append(themBar);

    wrInBar(group, cx - barW / 2 - 2, padTop + plotH - youH, youH, youRate, !row.dropped && isThin(row.you));
    wrInBar(group, cx + 2 + barW / 2, padTop + plotH - themH, themH, themRate, !row.dropped && isThin(row.them));

    const delta =
      youRate != null && themRate != null
        ? pickAdvantage(row.you, row.them, adjust)
        : null;
    if (delta != null) {
      const deltaText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      deltaText.setAttribute("x", String(cx));
      deltaText.setAttribute("y", String(padTop - 6));
      deltaText.setAttribute("text-anchor", "middle");
      deltaText.setAttribute("font-size", "9");
      deltaText.setAttribute("font-weight", "700");
      deltaText.setAttribute("fill", delta >= 0 ? "#7dce7d" : "#e07070");
      const rounded = Math.round(delta * 100);
      deltaText.textContent = `${rounded > 0 ? "+" : ""}${rounded}%`;
      group.append(deltaText);
    }

    const name = document.createElementNS("http://www.w3.org/2000/svg", "text");
    name.setAttribute("x", String(cx));
    name.setAttribute("y", String(height - 7));
    name.setAttribute("text-anchor", "middle");
    name.setAttribute("fill", "#ddd");
    name.setAttribute("font-size", "9");
    name.setAttribute("font-weight", "600");
    name.textContent = shortLabel(row.displayName);
    group.append(name);

    const youLabel = document.createElementNS("http://www.w3.org/2000/svg", "title");
    youLabel.textContent = `${row.displayName}: you ${pct(row.you.winRate)} (${row.you.games})${adjust ? ` adj ${pct(youRate)}` : ""}, them ${pct(row.them.winRate)} (${row.them.games})${adjust ? ` adj ${pct(themRate)}` : ""}`;
    group.append(youLabel);

    svg.append(group);
  });

  return svg;
}

export function formatChip(stat: TeamMapStat): string {
  if (stat.winRate == null) return `— (0)`;
  return `${Math.round(stat.winRate * 100)}% (${stat.games})`;
}
