import { nicknameFromToken } from "../lib/session-user";

const SKIP_NICKS = new Set([
  "search",
  "hubs",
  "hub",
  "teams",
  "team",
  "stats",
  "matches",
  "match",
  "players",
]);

function nickFromHref(href: string): string | undefined {
  const match = href.match(/\/players\/([^/?#]+)/i);
  if (!match) return undefined;
  const nick = decodeURIComponent(match[1]).trim();
  if (!nick || SKIP_NICKS.has(nick.toLowerCase())) return undefined;
  return nick;
}

function nicknamesFrom(root: ParentNode): string[] {
  const nicks: string[] = [];
  for (const anchor of root.querySelectorAll("a[href*='/players/']")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    const nick = nickFromHref(href);
    if (nick) nicks.push(nick);
  }
  return nicks;
}

function headerNickname(): string | undefined {
  const header =
    document.querySelector("header") ??
    document.querySelector("nav") ??
    document.querySelector('[data-testid="header"]');
  if (!header) return undefined;

  const fromLinks = nicknamesFrom(header);
  if (fromLinks[0]) return fromLinks[0];

  const labeled = header.querySelector(
    '[class*="Nickname"], [class*="nickname"], [data-testid*="nickname"]',
  );
  const text = labeled?.textContent?.trim();
  return text || undefined;
}

export function getFaceitToken(): string | undefined {
  const fromCookie = document.cookie
    .split("; ")
    .find((part) => part.startsWith("t="));
  if (fromCookie) {
    const value = decodeURIComponent(fromCookie.slice(2)).trim();
    if (value) return value;
  }

  try {
    const stored = localStorage.getItem("token") ?? sessionStorage.getItem("token");
    if (stored?.trim()) return stored.trim();
  } catch {
    return undefined;
  }
  return undefined;
}

export function detectMyNickname(): string | undefined {
  return nicknameFromToken(getFaceitToken()) ?? headerNickname();
}

export function getMatchIdFromUrl(url = location.href): string | undefined {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\/cs2\/room\/([^/]+)/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}
