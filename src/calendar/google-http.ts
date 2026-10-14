export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist";
export const CALENDAR_SCOPES = [CALENDAR_SCOPE, CALENDAR_LIST_SCOPE];
export const CALENDAR_API_ORIGIN = "https://www.googleapis.com";

export interface HttpRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface TokenProvider {
  token(interactive: boolean): Promise<string | null>;
  forget(token: string): Promise<void>;
}

export type HttpSender = (token: string, request: HttpRequest) => Promise<HttpResponse>;

export interface AuthorizedResult {
  status: number;
  body: unknown;
  code?: "auth_required" | "network" | "rate_limit" | "forbidden" | "insufficient_scope";
}

export function readPublicClientId(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-z0-9][a-z0-9.-]{8,160}\.apps\.googleusercontent\.com$/i.test(trimmed)) return "";
  return trimmed;
}

export async function authorizedRequest(args: {
  tokens: TokenProvider;
  send: HttpSender;
  request: HttpRequest;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  retainTokenOn401?: boolean;
}): Promise<AuthorizedResult> {
  let refreshed = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const access = await args.tokens.token(false);
    if (!access) return { status: 0, body: null, code: "auth_required" };
    let response: HttpResponse;
    try {
      response = await args.send(access, args.request);
    } catch {
      return { status: 0, body: null, code: "network" };
    }
    if (response.status === 401 && !refreshed && !args.retainTokenOn401) {
      refreshed = true;
      await args.tokens.forget(access);
      continue;
    }
    if (response.status === 401) return { status: 401, body: response.body, code: "auth_required" };
    if (response.status === 403 && isInsufficientScope(response.body)) {
      return { status: 403, body: response.body, code: "insufficient_scope" };
    }
    if (response.status === 403 && !isRateLimit(response.body)) {
      return { status: 403, body: response.body, code: "forbidden" };
    }
    if (isRetryable(response) && attempt < 2) {
      await args.sleep(backoff(attempt, args.random()));
      continue;
    }
    if (isRetryable(response)) return { status: response.status, body: response.body, code: "rate_limit" };
    return { status: response.status, body: response.body };
  }
  return { status: 0, body: null, code: "network" };
}

function isRetryable(response: HttpResponse): boolean {
  return response.status === 429 || response.status === 500 || response.status === 503 || (response.status === 403 && isRateLimit(response.body));
}

function isInsufficientScope(body: unknown): boolean {
  const reason = errorReason(body);
  const message = errorMessage(body).toLowerCase();
  return reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" || message.includes("insufficient");
}

function isRateLimit(body: unknown): boolean {
  const reason = errorReason(body);
  return reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || reason === "quotaExceeded";
}

function errorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const message = (body as { error?: { message?: unknown } }).error?.message;
  return typeof message === "string" ? message : "";
}

function errorReason(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const errors = (body as { error?: { errors?: unknown } }).error?.errors;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  if (!first || typeof first !== "object") return "";
  const reason = (first as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : "";
}

function backoff(attempt: number, random: number): number {
  const base = 200 * 2 ** attempt;
  const jitter = Math.max(0, Math.min(1, random)) * 100;
  return base + jitter;
}
