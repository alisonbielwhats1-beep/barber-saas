type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  source: "distributed" | "local" | "unavailable";
};

type RateLimitInput = {
  namespace: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
  failClosed?: boolean;
};

type LocalEntry = {
  count: number;
  resetAt: number;
};

const localStore = new Map<string, LocalEntry>();

const LUA_FIXED_WINDOW = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[2])
end
local ttl = redis.call("TTL", KEYS[1])
return {current, ttl}
`;

async function hashIdentifier(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function cleanupLocalStore(now: number) {
  if (localStore.size < 1_000) return;
  for (const [key, entry] of localStore) {
    if (entry.resetAt <= now) localStore.delete(key);
  }
}

function checkLocal(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  cleanupLocalStore(now);
  const existing = localStore.get(key);
  const entry =
    !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowSeconds * 1_000 }
      : existing;

  entry.count += 1;
  localStore.set(key, entry);

  return {
    allowed: entry.count <= limit,
    limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
    source: "local",
  };
}

async function checkDistributed(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        LUA_FIXED_WINDOW,
        "1",
        key,
        String(limit),
        String(windowSeconds),
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      result?: unknown;
    };
    if (!Array.isArray(payload.result) || payload.result.length < 2) return null;
    const count = Number(payload.result[0]);
    const ttl = Number(payload.result[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttl)) return null;

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, ttl),
      source: "distributed",
    };
  } catch {
    return null;
  }
}

export async function checkRateLimit(
  input: RateLimitInput,
): Promise<RateLimitResult> {
  if (
    !input.namespace ||
    !input.identifier ||
    !Number.isInteger(input.limit) ||
    input.limit <= 0 ||
    !Number.isInteger(input.windowSeconds) ||
    input.windowSeconds <= 0
  ) {
    throw new Error("Configuração de rate limit inválida.");
  }

  const hashed = await hashIdentifier(input.identifier);
  const key = `salon-saas:rl:${input.namespace}:${hashed}`;

  const distributed = await checkDistributed(
    key,
    input.limit,
    input.windowSeconds,
  );
  if (distributed) return distributed;

  if (input.failClosed && process.env.NODE_ENV === "production") {
    return {
      allowed: false,
      limit: input.limit,
      remaining: 0,
      retryAfterSeconds: 30,
      source: "unavailable",
    };
  }

  // Defesa adicional e fallback de disponibilidade. Em Vercel, este mapa não
  // é compartilhado entre instâncias; configure Upstash para proteção global.
  return checkLocal(key, input.limit, input.windowSeconds);
}

export function clientIp(headers: Headers): string {
  const vercelIp = headers
    .get("x-vercel-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const candidate =
    vercelIp ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        headers.get("x-real-ip")?.trim());
  if (
    !candidate ||
    candidate.length > 64 ||
    !/^[0-9a-fA-F:.]+$/.test(candidate)
  ) {
    return "unknown";
  }
  return candidate.toLowerCase();
}

export function rateLimitStatus(result: RateLimitResult): 429 | 503 {
  return result.source === "unavailable" ? 503 : 429;
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "Retry-After": String(result.retryAfterSeconds),
  };
}

export function resetLocalRateLimitsForTests() {
  if (process.env.NODE_ENV !== "test") return;
  localStore.clear();
}
