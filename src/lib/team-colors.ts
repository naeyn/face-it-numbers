export const DEFAULT_YOU_COLOR = "#3d8bfd";
export const DEFAULT_THEM_COLOR = "#ff5500";

export type TeamPalette = {
  you: string;
  them: string;
  youSoft: string;
  themSoft: string;
};

export const COLOR_PRESETS: { id: string; label: string; you: string; them: string }[] = [
  { id: "blue-orange", label: "Blue / Orange", you: DEFAULT_YOU_COLOR, them: DEFAULT_THEM_COLOR },
  { id: "orange-blue", label: "Orange / Blue", you: DEFAULT_THEM_COLOR, them: DEFAULT_YOU_COLOR },
  { id: "green-red", label: "Green / Red", you: "#3dbe72", them: "#e07070" },
];

const HEX = /^#([0-9a-f]{6})$/i;

export function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (HEX.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return fallback;
}

function parseRgb(hex: string): [number, number, number] | undefined {
  const match = HEX.exec(hex);
  if (!match) return undefined;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const hex = [r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

function mixWhite(hex: string, amount: number): string {
  const rgb = parseRgb(hex);
  if (!rgb) return hex;
  return toHex(
    rgb[0] + (255 - rgb[0]) * amount,
    rgb[1] + (255 - rgb[1]) * amount,
    rgb[2] + (255 - rgb[2]) * amount,
  );
}

export function hexAlpha(hex: string, alpha: number): string {
  const rgb = parseRgb(hex);
  if (!rgb) return `rgba(61, 139, 253, ${alpha})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function teamPalette(youColor: string, themColor: string): TeamPalette {
  const you = normalizeHex(youColor, DEFAULT_YOU_COLOR);
  const them = normalizeHex(themColor, DEFAULT_THEM_COLOR);
  return {
    you,
    them,
    youSoft: mixWhite(you, 0.42),
    themSoft: mixWhite(them, 0.42),
  };
}

export function applyTeamColors(node: HTMLElement, youColor: string, themColor: string): void {
  const palette = teamPalette(youColor, themColor);
  node.style.setProperty("--fin-you", palette.you);
  node.style.setProperty("--fin-them", palette.them);
  node.style.setProperty("--fin-you-soft", palette.youSoft);
  node.style.setProperty("--fin-them-soft", palette.themSoft);
}
