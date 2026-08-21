import { FACEIT_API_BASE, FACEIT_SITE_API_BASE } from "./constants";

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

async function fetchOnce(
  url: string,
  token: string | undefined,
  attempt: number,
): Promise<Response> {
  const response = await fetch(url, {
    method: "GET",
    headers: bearer(token),
    credentials: "omit",
  });

  if ((response.status === 429 || response.status === 503) && attempt < 3) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const waitMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 800 * 2 ** attempt;
    await sleep(waitMs);
    return fetchOnce(url, token, attempt + 1);
  }

  return response;
}

export async function faceitGet(
  path: string,
  token: string | undefined,
): Promise<unknown> {
  const urls = [`${FACEIT_API_BASE}${path}`, `${FACEIT_SITE_API_BASE}${path}`];
  let lastError: FaceitApiError | undefined;

  for (const url of urls) {
    const response = await fetchOnce(url, token, 0);
    if (response.status === 404) {
      throw new FaceitApiError(404, "Not found");
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
