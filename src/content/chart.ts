import { type ChartBadge } from "../lib/insights";
import { formatScore, mapScore } from "../lib/score";
import {
  DEFAULT_THEM_COLOR,
  DEFAULT_YOU_COLOR,
  hexAlpha,
  teamPalette,
  type TeamPalette,
} from "../lib/team-colors";
import type { SmartSummary, TeamMapStat } from "../lib/types";

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

const SVG_NS = "http://www.w3.org/2000/svg";

const WIDTH = 380;
const ROW_H = 22;
const PAD_TOP = 20;
const PAD_BOTTOM = 6;
const NAME_COL = 74;
const BADGE_COL = 42;
const LABEL_GAP = 24;

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function badgeLabel(
  badge: ChartBadge,
  colors: TeamPalette,
): { text: string; fill: string } | undefined {
  if (badge === "ban") return { text: "BAN", fill: "#e07070" };
  if (badge === "perm-you") return { text: "PERM", fill: colors.you };
  if (badge === "perm-them") return { text: "THEIRS", fill: colors.them };
  return undefined;
}

/**
 * One diverging bar per map: right in your colour when the edge score favours
 * you, left in theirs when it does not. Deliberately not shaped like the old
 * paired win-rate bars — this is a verdict, not a rate.
 */
export function renderChart(
  rows: ChartRow[],
  selectedMap: string | undefined,
  onSelect: (mapKey: string) => void,
  smart?: SmartSummary,
  colors: TeamPalette = teamPalette(DEFAULT_YOU_COLOR, DEFAULT_THEM_COLOR),
): SVGSVGElement {
  const height = PAD_TOP + rows.length * ROW_H + PAD_BOTTOM;
  const plotW = WIDTH - NAME_COL - BADGE_COL;
  const cx = NAME_COL + plotW / 2;
  const halfBar = plotW / 2 - LABEL_GAP;

  const svg = el("svg", {
    viewBox: `0 0 ${WIDTH} ${height}`,
    width: "100%",
    role: "img",
    "aria-label": "Edge score per map",
  });

  // The scale is labelled on the axis itself, so "even" always sits exactly
  // over the zero line no matter how wide the name column runs.
  const axis: Array<[number, string, string, string]> = [
    [cx - halfBar, "start", "#6b7380", "−100"],
    [cx - 6, "end", colors.them, "them ◀"],
    [cx + 6, "start", colors.you, "▶ you"],
    [cx + halfBar, "end", "#6b7380", "+100"],
  ];
  for (const [x, anchor, fill, label] of axis) {
    const text = el("text", {
      x,
      y: PAD_TOP - 8,
      "text-anchor": anchor,
      fill,
      "font-size": 9,
      "font-weight": 700,
    });
    text.textContent = label;
    svg.append(text);
  }

  svg.append(
    el("line", {
      x1: cx,
      x2: cx,
      y1: PAD_TOP - 4,
      y2: height - PAD_BOTTOM + 2,
      stroke: "#4a5160",
      "stroke-width": 1,
    }),
  );

  rows.forEach((row, index) => {
    const top = PAD_TOP + index * ROW_H;
    const mid = top + ROW_H / 2;
    const score = mapScore(row.you, row.them, row.mapKey, smart);
    const thin = Boolean(row.thin);
    const selected = selectedMap === row.mapKey;

    const group = el("g", {});
    group.style.cursor = "pointer";
    if (row.dropped) group.setAttribute("opacity", "0.35");
    group.addEventListener("click", () => onSelect(row.mapKey));

    if (selected || row.picked) {
      group.append(
        el("rect", {
          x: 2,
          y: top + 1,
          width: WIDTH - 4,
          height: ROW_H - 2,
          fill: selected ? hexAlpha(colors.you, 0.12) : "rgba(255,255,255,0.04)",
          rx: 4,
        }),
      );
    }

    const name = el("text", {
      x: NAME_COL - 10,
      y: mid + 3,
      "text-anchor": "end",
      fill: "#ddd",
      "font-size": 10,
      "font-weight": 600,
    });
    name.textContent = row.displayName;
    group.append(name);

    const width = Math.max(2, (Math.abs(score) / 100) * halfBar);
    const positive = score >= 0;
    const fill = positive ? colors.you : colors.them;
    const bar = el("rect", {
      x: positive ? cx : cx - width,
      y: mid - 5,
      width,
      height: 10,
      fill,
      rx: 2,
    });
    if (thin) bar.setAttribute("opacity", "0.4");
    group.append(bar);

    const value = el("text", {
      x: positive ? cx + width + 5 : cx - width - 5,
      y: mid + 3,
      "text-anchor": positive ? "start" : "end",
      fill: thin ? "#8d94a2" : fill,
      "font-size": 10,
      "font-weight": 800,
    });
    value.style.pointerEvents = "none";
    value.textContent = formatScore(score);
    group.append(value);

    const meta = row.badge ? badgeLabel(row.badge, colors) : undefined;
    if (meta) {
      const tag = el("text", {
        x: WIDTH - 4,
        y: mid + 3,
        "text-anchor": "end",
        "font-size": 8,
        "font-weight": 800,
        "letter-spacing": "0.04em",
        fill: meta.fill,
      });
      tag.textContent = meta.text;
      group.append(tag);
    }

    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${row.displayName}: score ${formatScore(score)} · raw win rate you ${pct(row.you.winRate)} (${row.you.games}), them ${pct(row.them.winRate)} (${row.them.games})`;
    group.append(title);

    svg.append(group);
  });

  return svg;
}

/** Raw last-30 win rate with its game count — the breakdown's evidence line. */
export function formatChip(stat: TeamMapStat): string {
  if (stat.winRate == null) return `— (0)`;
  return `${Math.round(stat.winRate * 100)}% (${stat.games})`;
}
