const NICK_KEYS = ["nickname", "nick", "preferred_username"];
// Faceit's own player_id: the JWT calls it `guid`, older sessions `sub`.
const ID_KEYS = ["guid", "user_id", "userId", "player_id", "playerId", "sub"];

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNick(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const nick = value.trim();
  if (!nick || nick.length > 32 || nick.includes("@") || /\s/.test(nick)) return undefined;
  return nick;
}

// Lower-cased so callers can compare against a roster id without repeating the
// fold; Faceit hands the same guid back in either case depending on endpoint.
function asId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return GUID.test(id) ? id.toLowerCase() : undefined;
}

// Both claims hide at a different depth depending on which endpoint or token
// version produced the payload, so look for named keys first at every level
// and only then descend.
function findClaim(
  value: unknown,
  keys: readonly string[],
  accept: (raw: unknown) => string | undefined,
  depth: number,
): string | undefined {
  if (depth > 5) return undefined;
  const record = asRecord(value);
  if (!record) return undefined;

  for (const key of keys) {
    const hit = accept(record[key]);
    if (hit) return hit;
  }

  for (const child of Object.values(record)) {
    if (!child || typeof child !== "object") continue;
    const hit = findClaim(child, keys, accept, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

export function nicknameFromPayload(value: unknown, depth = 0): string | undefined {
  return findClaim(value, NICK_KEYS, asNick, depth);
}

/**
 * The account's player_id. Worth preferring over the nickname wherever a
 * roster is involved: it is what the roster is keyed by, it survives a
 * nickname change, and it cannot collide with another player's display name.
 */
export function userIdFromPayload(value: unknown, depth = 0): string | undefined {
  return findClaim(value, ID_KEYS, asId, depth);
}

function decodeJwtPayload(token: string): unknown {
  const raw = token.replace(/^Bearer\s+/i, "").trim();
  const parts = raw.split(".");
  if (parts.length < 2) return undefined;
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const json = atob(padded);
  return JSON.parse(json) as unknown;
}

export function nicknameFromToken(token: string | undefined): string | undefined {
  if (!token?.trim()) return undefined;
  try {
    return nicknameFromPayload(decodeJwtPayload(token));
  } catch {
    return undefined;
  }
}

export function userIdFromToken(token: string | undefined): string | undefined {
  if (!token?.trim()) return undefined;
  try {
    return userIdFromPayload(decodeJwtPayload(token));
  } catch {
    return undefined;
  }
}
