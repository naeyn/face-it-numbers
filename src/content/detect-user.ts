import { nicknameFromToken, userIdFromToken } from "../lib/session-user";

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

// The header carries other player links than yours — a recent-teammates
// dropdown, an invite popover — and picking the wrong one puts the panel on
// the wrong side. Your own link is the one inside the account control, so
// look there first and only then fall back to whatever came first.
const SELF_CONTAINERS = [
  '[class*="Avatar"]',
  '[class*="avatar"]',
  '[data-testid*="avatar"]',
  '[class*="UserMenu"]',
  '[class*="user-menu"]',
  '[data-testid*="user-menu"]',
  '[class*="Profile"]',
  '[data-testid*="profile"]',
];

function selfNickname(header: Element): string | undefined {
  for (const selector of SELF_CONTAINERS) {
    for (const node of header.querySelectorAll(selector)) {
      const nick = nicknamesFrom(node)[0];
      if (nick) return nick;
    }
  }
  return undefined;
}

function headerNickname(): string | undefined {
  const header =
    document.querySelector("header") ??
    document.querySelector("nav") ??
    document.querySelector('[data-testid="header"]');
  if (!header) return undefined;

  const fromSelf = selfNickname(header);
  if (fromSelf) return fromSelf;

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

/**
 * Exact where the nickname is only a guess: the roster is keyed by player_id,
 * so a hit here settles the side outright instead of relying on two display
 * names folding to the same string.
 */
export function detectMyPlayerId(): string | undefined {
  return userIdFromToken(getFaceitToken());
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
