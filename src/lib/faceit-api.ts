import {
  FACEIT_API_BASE,
  FACEIT_SITE_API_BASE,
  RATE_LIMIT_COOLDOWN_MS,
} from "./constants";

export class FaceitApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "FaceitApiError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bearer(token: string | undefined): Record<string, string> {
  if (!token) return { Accept: "application/json" };
  const value = token.replace(/^Bearer\s+/i, "").trim();
  return {
    Accept: "application/json",
    Authorization: `Bearer ${value}`,
  };
}

function unwrap(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const record = data as {
    code?: string;
    result?: string;
    payload?: unknown;
    errors?: unknown;
  };
  if (record.payload !== undefined) {
    const code = (record.code ?? record.result ?? "OK").toString().toUpperCase();
    if (code && code !== "OK" && code !== "OPERATION-OK") {
      throw new FaceitApiError(400, `Faceit error: ${code}`);
    }
    return record.payload;
  }
  return data;
}

// Shared cooldown after a hard 429: many pipeline requests run in parallel,
// and once Faceit starts limiting, each of them retrying only feeds the same
// limiter. One failure trips the breaker; everyone else fails fast until it
// expires and callers degrade to caches.
let cooldownUntil = 0;

function cooldownActive(): boolean {
  return Date.now() < cooldownUntil;
}

function tripCooldown(retryAfterHeader: string | null): void {
  const retryAfter = Number(retryAfterHeader);
  const waitMs = Number.isFinite(retryAfter)
    ? Math.min(Math.max(retryAfter * 1000, RATE_LIMIT_COOLDOWN_MS), 60000)
    : RATE_LIMIT_COOLDOWN_MS;
  cooldownUntil = Math.max(cooldownUntil, Date.now() + waitMs);
}

async function fetchOnce(
  url: string,
  token: string | undefined,
  attempt: number,
): Promise<Response> {
  // Faceit's session lives in HttpOnly `__Host-` cookies that no script can
  // read, so a bearer header alone cannot authenticate us. Sending the cookies
  // is the only way to reach account-scoped endpoints; Chrome treats a request
  // from a service worker holding host permissions as first-party, so even the
  // SameSite=Lax session cookie rides along. Only Faceit hosts go through here
  // — Leetify has its own uncredentialed fetch.
  const response = await fetch(url, {
    method: "GET",
    headers: bearer(token),
    credentials: "include",
  });

  const canRetry =
    response.status === 503
      ? attempt < 2
      : response.status === 429 && attempt < 1 && !cooldownActive();
  if (canRetry) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    // Cap the wait: an honest Retry-After of 30s+ must not stall the whole
    // refresh pipeline — better to fail this request and degrade.
    const waitMs = Math.min(
      Number.isFinite(retryAfter) ? retryAfter * 1000 : 800 * 2 ** attempt,
      2000,
    );
    await sleep(waitMs);
    return fetchOnce(url, token, attempt + 1);
  }

  return response;
}

/**
 * `siteFirst` is for account-scoped paths. The session cookies are `__Host-`
 * prefixed, which pins them to www.faceit.com, so api.faceit.com can never
 * answer as us — asking it first buys a guaranteed 403 and a wasted round
 * trip. Public paths keep the original order.
 */
export async function faceitGet(
  path: string,
  token: string | undefined,
  { siteFirst = false }: { siteFirst?: boolean } = {},
): Promise<unknown> {
  const bases = siteFirst
    ? [FACEIT_SITE_API_BASE, FACEIT_API_BASE]
    : [FACEIT_API_BASE, FACEIT_SITE_API_BASE];
  const urls = bases.map((base) => `${base}${path}`);
  let lastError: FaceitApiError | undefined;

  if (cooldownActive()) {
    throw new FaceitApiError(429, "Rate limited by Faceit.");
  }

  for (const url of urls) {
    const response = await fetchOnce(url, token, 0);
    if (response.status === 404) {
      throw new FaceitApiError(404, "Not found");
    }
    // A rejected request shape is rejected by both bases — they front the same
    // services. Only 401/403 are worth re-asking, since the session cookies
    // reach one host and not the other.
    if (response.status === 400 || response.status === 422) {
      throw new FaceitApiError(response.status, "Rejected by Faceit");
    }
    if (response.status === 429) {
      // Rate limited after retries: trying the fallback base would only add
      // more pressure on the same limiter. Fail fast; callers degrade.
      tripCooldown(response.headers.get("Retry-After"));
      throw new FaceitApiError(429, "Rate limited by Faceit.");
    }
    if (response.status === 401 || response.status === 403) {
      lastError = new FaceitApiError(
        response.status,
        "Log into Faceit in this browser, then reload the match room.",
      );
      continue;
    }
    if (!response.ok) {
      lastError = new FaceitApiError(
        response.status,
        (await response.text()).slice(0, 300) || response.statusText,
      );
      continue;
    }
    return unwrap(await response.json());
  }

  throw lastError ?? new FaceitApiError(0, "Could not reach Faceit.");
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
