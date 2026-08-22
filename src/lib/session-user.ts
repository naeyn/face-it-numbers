const NICK_KEYS = ["nickname", "nick", "preferred_username"];

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

export function nicknameFromPayload(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  const record = asRecord(value);
  if (!record) return undefined;

  for (const key of NICK_KEYS) {
    const nick = asNick(record[key]);
    if (nick) return nick;
  }

  for (const child of Object.values(record)) {
    if (!child || typeof child !== "object") continue;
    const nick = nicknameFromPayload(child, depth + 1);
    if (nick) return nick;
  }
  return undefined;
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
