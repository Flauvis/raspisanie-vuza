import { authorizedRequest, CALENDAR_API_ORIGIN, type AuthorizedResult, type HttpRequest, type TokenProvider } from "./google-http";
import { isCalendarColorId } from "./colors";
import { APP_NAME, type CalendarApi, type GoogleEventBody, type ListedCalendar, type OwnedEvent } from "./test-write";

export function createGoogleCalendarApi(args: {
  tokens: TokenProvider;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}): CalendarApi {
  const fetchImpl = args.fetchImpl ?? fetch;
  const sleep = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = args.random ?? Math.random;
  const call = (request: HttpRequest, retainTokenOn401 = false) =>
    authorizedRequest({
      tokens: args.tokens,
      send: (token, next) => send(fetchImpl, token, next),
      request,
      sleep,
      random,
      retainTokenOn401,
    });

  return {
    async hasSession() {
      return Boolean(await args.tokens.token(false));
    },
    async listCalendars() {
      const calendars: ListedCalendar[] = [];
      let pageToken = "";
      for (let page = 0; page < 5; page += 1) {
        const suffix = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
        const response = await call({ method: "GET", path: `/calendar/v3/users/me/calendarList?maxResults=250${suffix}` });
        if (response.code === "auth_required") return { ok: false, code: "auth" };
        if (response.code === "insufficient_scope") return { ok: false, code: "scope" };
        if (response.code === "forbidden") return { ok: false, code: "forbidden" };
        if (response.code || response.status !== 200) return { ok: false, code: "error" };
        const parsed = readList(response.body);
        calendars.push(...parsed.items);
        if (!parsed.nextPageToken) break;
        pageToken = parsed.nextPageToken;
      }
      return { ok: true, calendars };
    },
    async getCalendar(id) {
      const response = await call({ method: "GET", path: `/calendar/v3/calendars/${encodeURIComponent(id)}` });
      if (response.code === "auth_required") return "auth";
      if (response.code === "forbidden") return "forbidden";
      if (response.status === 404) return "missing";
      if (response.status === 200) return "ok";
      return "error";
    },
    async createCalendar(summary) {
      const response = await call({ method: "POST", path: "/calendar/v3/calendars", body: { summary } });
      const id = response.status === 200 ? stringField(response.body, "id") : "";
      if (response.code === "auth_required") return { ok: false, code: "auth" };
      if (response.code === "forbidden") return { ok: false, code: "forbidden" };
      if (!id) return { ok: false, code: "error" };
      return { ok: true, id };
    },
    async setCalendarColor(id, colorId) {
      if (!isCalendarColorId(colorId)) return { ok: false, code: "error", status: 0 };
      return paintCalendar(call, id, colorId);
    },
    async releaseLessonColors(id) {
      return clearLessonColors(call, id);
    },
    async deleteCalendar(id) {
      const response = await call({ method: "DELETE", path: `/calendar/v3/calendars/${encodeURIComponent(id)}` });
      if (response.status === 204 || response.status === 200) return { ok: true };
      if (response.status === 404) return { ok: false, code: "missing", status: 404 };
      if (response.code === "auth_required") return { ok: false, code: "auth", status: response.status };
      if (response.code === "forbidden" || response.code === "insufficient_scope") return { ok: false, code: "forbidden", status: response.status };
      return { ok: false, code: "error", status: response.status };
    },
    async deleteEvent(calendarId, eventId, etag) {
      const response = await call({
        method: "DELETE",
        path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        ...(etag ? { headers: { "If-Match": etag } } : {}),
      });
      if (response.status === 204 || response.status === 200) return { ok: true };
      if (response.status === 404 || response.status === 410) return { ok: false, code: "missing" };
      if (response.status === 412 || response.status === 409) return { ok: false, code: "conflict" };
      if (response.code === "auth_required") return { ok: false, code: "auth" };
      if (response.code === "forbidden" || response.code === "insufficient_scope") return { ok: false, code: "forbidden" };
      return { ok: false, code: "error" };
    },
    async getEvent(calendarId, eventId) {
      const response = await call({
        method: "GET",
        path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      });
      if (response.code === "auth_required") return { ok: false, code: "auth" };
      if (response.status === 404) return { ok: false, code: "missing" };
      if (response.status !== 200) return { ok: false, code: "error" };
      return { ok: true, body: response.body };
    },
    async insertEvent(calendarId, body) {
      const response = await call({
        method: "POST",
        path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        body: eventPayload(body),
      });
      if (response.code === "auth_required") return { ok: false, status: 401, code: "auth" };
      if (response.code === "forbidden") return { ok: false, status: 403, code: "forbidden" };
      if (response.status === 409) return { ok: false, status: 409, code: "conflict" };
      if (response.status !== 200) return { ok: false, status: response.status, code: "error" };
      return { ok: true };
    },
    async patchEvent(calendarId, eventId, body, etag) {
      const response = await call({
        method: "PATCH",
        path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        body,
        ...(etag ? { headers: { "If-Match": etag } } : {}),
      });
      if (response.code === "auth_required") return { ok: false, code: "auth" };
      if (response.code === "forbidden") return { ok: false, code: "forbidden" };
      if (response.status === 412 || response.status === 409) return { ok: false, code: "conflict" };
      if (response.status !== 200) return { ok: false, code: "error" };
      return { ok: true };
    },
    async hasAppEvents(calendarId) {
      const response = await call({
        method: "GET",
        path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=1&showDeleted=false&privateExtendedProperty=${encodeURIComponent(`app=${APP_NAME}`)}`,
      });
      if (response.code === "auth_required") return { ok: false, code: "auth" };
      if (response.code === "forbidden" || response.code === "insufficient_scope") return { ok: false, code: "forbidden" };
      if (response.code || response.status !== 200) return { ok: false, code: "error" };
      return { ok: true, found: eventItems(response.body).length > 0 };
    },
    async listOwnedEvents(calendarId) {
      const events: OwnedEvent[] = [];
      let pageToken = "";
      for (let page = 0; page < 8; page += 1) {
        const suffix = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
        const response = await call({
          method: "GET",
          path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=250&showDeleted=false&privateExtendedProperty=${encodeURIComponent(`app=${APP_NAME}`)}${suffix}`,
        });
        if (response.code === "auth_required") return { ok: false, code: "auth" };
        if (response.code === "forbidden" || response.code === "insufficient_scope") return { ok: false, code: "forbidden" };
        if (response.code || response.status !== 200) return { ok: false, code: "error" };
        const parsed = readEvents(response.body);
        events.push(...parsed.items);
        if (!parsed.nextPageToken) break;
        pageToken = parsed.nextPageToken;
      }
      return { ok: true, events };
    },
  };
}

function eventPayload(body: GoogleEventBody): GoogleEventBody {
  return {
    id: body.id,
    summary: body.summary,
    ...(body.location ? { location: body.location } : {}),
    ...(body.description ? { description: body.description } : {}),
    start: body.start,
    end: body.end,
    extendedProperties: body.extendedProperties,
  };
}

async function send(fetchImpl: typeof fetch, token: string, request: HttpRequest): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(`${CALENDAR_API_ORIGIN}${request.path}`, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...request.headers,
    },
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: parseJson(text) };
}

async function paintCalendar(
  call: (request: HttpRequest, retainTokenOn401?: boolean) => Promise<AuthorizedResult>,
  id: string,
  colorId: string,
): Promise<{ ok: true } | { ok: false; code: "auth" | "forbidden" | "scope" | "error"; status: number }> {
  const patched = await call({
    method: "PATCH",
    path: `/calendar/v3/users/me/calendarList/${encodeURIComponent(id)}`,
    body: { colorId },
  }, true);
  const result = colorResult(patched);
  if (result === "ok") return { ok: true };
  return { ok: false, code: result === "missing" ? "error" : result, status: patched.status };
}

async function clearLessonColors(
  call: (request: HttpRequest, retainTokenOn401?: boolean) => Promise<AuthorizedResult>,
  calendarId: string,
): Promise<{ ok: true } | { ok: false; code: "auth" | "forbidden" | "scope" | "error"; status: number }> {
  let pageToken = "";
  for (let page = 0; page < 8; page += 1) {
    const suffix = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
    const response = await call({
      method: "GET",
      path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=250&showDeleted=false&privateExtendedProperty=${encodeURIComponent(`app=${APP_NAME}`)}${suffix}`,
    }, true);
    const listed = colorResult(response);
    if (listed !== "ok") return { ok: false, code: listed === "missing" ? "error" : listed, status: response.status };
    const parsed = readColorEvents(response.body);
    for (const event of parsed.items) {
      if (!event.colorId) continue;
      const patched = await call({
        method: "PATCH",
        path: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
        body: { colorId: null },
      }, true);
      const result = colorResult(patched);
      if (result !== "ok") return { ok: false, code: result === "missing" ? "error" : result, status: patched.status };
    }
    if (!parsed.nextPageToken) return { ok: true };
    pageToken = parsed.nextPageToken;
  }
  return { ok: true };
}

function readColorEvents(body: unknown): { items: { id: string; colorId: string }[]; nextPageToken: string } {
  if (!body || typeof body !== "object") return { items: [], nextPageToken: "" };
  const source = body as { items?: unknown; nextPageToken?: unknown };
  const items = Array.isArray(source.items) ? source.items.flatMap(readColorEvent) : [];
  const nextPageToken = typeof source.nextPageToken === "string" ? source.nextPageToken : "";
  return { items, nextPageToken };
}

function readColorEvent(value: unknown): { id: string; colorId: string }[] {
  if (!value || typeof value !== "object") return [];
  const source = value as Record<string, unknown>;
  if (source.status === "cancelled") return [];
  const props = privateProps(source.extendedProperties);
  const id = stringField(source, "id");
  if (!id || id.includes("://") || props.app !== APP_NAME) return [];
  return [{ id, colorId: stringField(source, "colorId") }];
}

function colorResult(response: AuthorizedResult): "ok" | "auth" | "forbidden" | "scope" | "error" | "missing" {
  if (response.status === 0 && response.code === "auth_required") return "auth";
  if (response.code === "insufficient_scope") return "scope";
  if (response.code === "forbidden" || response.code === "auth_required") return "forbidden";
  if (response.status === 200) return "ok";
  if (response.status === 404) return "missing";
  return "error";
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readList(body: unknown): { items: ListedCalendar[]; nextPageToken: string } {
  if (!body || typeof body !== "object") return { items: [], nextPageToken: "" };
  const source = body as { items?: unknown; nextPageToken?: unknown };
  const items = Array.isArray(source.items) ? source.items.flatMap(readCalendar) : [];
  const nextPageToken = typeof source.nextPageToken === "string" ? source.nextPageToken : "";
  return { items, nextPageToken };
}

function readCalendar(value: unknown): ListedCalendar[] {
  if (!value || typeof value !== "object") return [];
  const source = value as Record<string, unknown>;
  const id = stringField(source, "id");
  if (!id || id.includes("://")) return [];
  const summary = stringField(source, "summary") || "Календарь приложения";
  return [{ id, summary, ...(source.primary === true ? { primary: true } : {}) }];
}

function eventItems(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const items = (body as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

function readEvents(body: unknown): { items: OwnedEvent[]; nextPageToken: string } {
  if (!body || typeof body !== "object") return { items: [], nextPageToken: "" };
  const source = body as { items?: unknown; nextPageToken?: unknown };
  const items = Array.isArray(source.items) ? source.items.flatMap(readOwnedEvent) : [];
  const nextPageToken = typeof source.nextPageToken === "string" ? source.nextPageToken : "";
  return { items, nextPageToken };
}

function readOwnedEvent(value: unknown): OwnedEvent[] {
  if (!value || typeof value !== "object") return [];
  const source = value as Record<string, unknown>;
  if (source.status === "cancelled") return [];
  const id = stringField(source, "id");
  const etag = stringField(source, "etag");
  const props = privateProps(source.extendedProperties);
  if (!id || id.includes("://") || props.app !== APP_NAME || !props.lessonKey || !props.sourceKey) return [];
  const start = dateTimeField(source.start);
  const end = dateTimeField(source.end);
  if (!start || !end) return [];
  return [{
    id,
    etag,
    summary: stringField(source, "summary"),
    location: stringField(source, "location"),
    description: stringField(source, "description"),
    start: start.dateTime,
    end: end.dateTime,
    timeZone: start.timeZone,
    lessonKey: props.lessonKey,
    sourceKey: props.sourceKey,
    sourceHash: props.sourceHash,
  }];
}

function privateProps(value: unknown): { app: string; lessonKey: string; sourceKey: string; sourceHash: string } {
  if (!value || typeof value !== "object") return { app: "", lessonKey: "", sourceKey: "", sourceHash: "" };
  const priv = (value as { private?: unknown }).private;
  if (!priv || typeof priv !== "object") return { app: "", lessonKey: "", sourceKey: "", sourceHash: "" };
  const source = priv as Record<string, unknown>;
  return {
    app: typeof source.app === "string" ? source.app : "",
    lessonKey: typeof source.lessonKey === "string" ? source.lessonKey : "",
    sourceKey: typeof source.sourceKey === "string" ? source.sourceKey : "",
    sourceHash: typeof source.sourceHash === "string" ? source.sourceHash : "",
  };
}

function dateTimeField(value: unknown): { dateTime: string; timeZone: string } | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.dateTime !== "string") return null;
  return { dateTime: source.dateTime, timeZone: typeof source.timeZone === "string" ? source.timeZone : "" };
}

function stringField(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : "";
}
