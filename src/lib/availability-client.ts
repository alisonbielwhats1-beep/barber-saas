export type AvailabilitySlot = {
  appointmentId: string;
  time: string;
};

export type AvailabilityResult = {
  slots: string[];
  popularSlot: string | null;
  occupied: AvailabilitySlot[];
};

export type AvailabilityErrorCode =
  | "aborted"
  | "invalid_response"
  | "network"
  | "rate_limited"
  | "server_error"
  | "timeout";

export class AvailabilityRequestError extends Error {
  constructor(
    readonly code: AvailabilityErrorCode,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = "AvailabilityRequestError";
  }
}

type AvailabilityRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

export const MAX_RETRY_AFTER_SECONDS = 60 * 60;

function isOccupiedSlot(value: unknown): value is AvailabilitySlot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.appointmentId === "string" && typeof candidate.time === "string";
}

function clampRetryAfter(seconds: number) {
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(0, Math.ceil(seconds)));
}

export function parseRetryAfter(value: string | null, nowMs = Date.now()) {
  if (!value) return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    return Number.isSafeInteger(seconds) ? clampRetryAfter(seconds) : MAX_RETRY_AFTER_SECONDS;
  }
  if (/^[+-]?\d/.test(normalized)) return null;

  const retryAt = Date.parse(normalized);
  if (Number.isNaN(retryAt)) return null;
  return clampRetryAfter((retryAt - nowMs) / 1_000);
}

/**
 * Cliente estrito da disponibilidade pública. Um dia realmente lotado é uma
 * resposta 200 com `slots: []`; indisponibilidade técnica nunca vira agenda
 * vazia por acidente.
 */
export async function requestAvailability(
  url: string,
  {
    signal,
    timeoutMs = 10_000,
    fetcher = fetch,
  }: AvailabilityRequestOptions = {},
): Promise<AvailabilityResult> {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    if (signal?.aborted) {
      throw new AvailabilityRequestError("aborted");
    }

    const response = await fetcher(url, { signal: controller.signal });
    if (response.status === 429) {
      throw new AvailabilityRequestError(
        "rate_limited",
        parseRetryAfter(response.headers.get("Retry-After")),
      );
    }
    if (!response.ok) {
      throw new AvailabilityRequestError("server_error");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AvailabilityRequestError("invalid_response");
    }

    if (!body || typeof body !== "object") {
      throw new AvailabilityRequestError("invalid_response");
    }
    const payload = body as Record<string, unknown>;
    if (
      !Array.isArray(payload.slots) ||
      !payload.slots.every((slot) => typeof slot === "string") ||
      !Array.isArray(payload.occupied) ||
      !payload.occupied.every(isOccupiedSlot) ||
      !(payload.popularSlot === null || typeof payload.popularSlot === "string")
    ) {
      throw new AvailabilityRequestError("invalid_response");
    }

    return {
      slots: payload.slots,
      popularSlot: payload.popularSlot,
      occupied: payload.occupied,
    };
  } catch (error) {
    if (error instanceof AvailabilityRequestError) throw error;
    if (timedOut) throw new AvailabilityRequestError("timeout");
    if (signal?.aborted) throw new AvailabilityRequestError("aborted");
    throw new AvailabilityRequestError("network");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

export function availabilityErrorMessage(error: AvailabilityRequestError) {
  switch (error.code) {
    case "rate_limited":
      if (error.retryAfterSeconds === 0) {
        return "Muitas consultas em pouco tempo. Tente novamente.";
      }
      return error.retryAfterSeconds !== null
        ? `Muitas consultas em pouco tempo. Aguarde ${error.retryAfterSeconds}s e tente novamente.`
        : "Muitas consultas em pouco tempo. Aguarde um instante e tente novamente.";
    case "timeout":
      return "A consulta demorou mais que o esperado. Confira sua conexão e tente novamente.";
    case "invalid_response":
      return "Não conseguimos interpretar os horários agora. Tente novamente em instantes.";
    case "network":
    case "server_error":
      return "Não foi possível carregar os horários. Suas escolhas continuam salvas.";
    case "aborted":
      return "";
  }
}
