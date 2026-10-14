import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mockUniversityAdapter } from "../src/adapters/mock/adapter";
import { realUniversityAdapter } from "../src/adapters/real/adapter";
import { calendarEventDraft, googleCalendarWrite, GOOGLE_WRITES_ENABLED } from "../src/calendar/writes";
import { readPageFailClosed } from "../src/content/reader";
import { canProposeCancellations } from "../src/domain/cancellation";
import { evaluateReadRequest, LIVE_PAGE_READ_ENABLED } from "../src/domain/read-gate";
import { validateSettings } from "../src/domain/settings";
import { isTrustedExtensionSender, handleMessage } from "../src/background/handle-message";
import { createMemoryStore } from "../src/storage/state";
import { CAPTURED_AT } from "./helpers";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("read gate", () => {
  it("blocks reading until the site and adapter exist", () => {
    expect(LIVE_PAGE_READ_ENABLED).toBe(true);
    expect(
      evaluateReadRequest({
        timeZone: "",
        sourceOrigin: "",
        sourcePathPrefix: "",
        tabUrl: "https://university.example/schedule",
        adapterConfiguredForUrl: false,
      }).code,
    ).toBe("timezone_missing");
    expect(
      evaluateReadRequest({
        timeZone: "Europe/Moscow",
        sourceOrigin: "",
        sourcePathPrefix: "",
        tabUrl: "https://university.example/schedule",
        adapterConfiguredForUrl: true,
      }).code,
    ).toBe("origin_missing");
    expect(
      evaluateReadRequest({
        timeZone: "Europe/Moscow",
        sourceOrigin: "https://university.example",
        sourcePathPrefix: "/schedule",
        tabUrl: "https://other.example/schedule",
        adapterConfiguredForUrl: true,
      }).code,
    ).toBe("origin_mismatch");
    expect(
      evaluateReadRequest({
        timeZone: "Europe/Moscow",
        sourceOrigin: "https://university.example",
        sourcePathPrefix: "/schedule",
        tabUrl: "https://university.example/schedule-admin",
        adapterConfiguredForUrl: true,
      }).code,
    ).toBe("path_mismatch");
    const ready = evaluateReadRequest({
      timeZone: "Europe/Moscow",
      sourceOrigin: "https://university.example",
      sourcePathPrefix: "/schedule",
      tabUrl: "https://university.example/schedule/week",
      adapterConfiguredForUrl: true,
    });
    expect(ready.action).toBe("read");
    expect(ready.code).toBe("read");
  });
});

describe("settings and messages", () => {
  it("rejects origins that are not a bare https origin", () => {
    expect(validateSettings({ timeZone: "Europe/Moscow", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "" }).ok).toBe(true);
    expect(validateSettings({ timeZone: "PST", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "" }).ok).toBe(false);
    expect(validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "http://university.example", sourcePathPrefix: "" }).ok).toBe(false);
    expect(validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "https://user:pass@university.example", sourcePathPrefix: "" }).ok).toBe(false);
    expect(validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "https://university.example/schedule", sourcePathPrefix: "" }).ok).toBe(false);
    expect(validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "/schedule/../admin" }).ok).toBe(false);
    const keptOff = validateSettings({ timeZone: "Europe/Moscow", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "" });
    expect(keptOff.ok && keptOff.value.openCalendarAfterWrite).toBe(false);
    const turnedOn = validateSettings({ timeZone: "Europe/Moscow", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "", openCalendarAfterWrite: true });
    expect(turnedOn.ok && turnedOn.value.openCalendarAfterWrite).toBe(true);
    expect(validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "", openCalendarAfterWrite: "yes" }).ok).toBe(false);
    expect(validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "", calendarColorId: "16" }).ok).toBe(true);
    expect(validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "", calendarColorId: "25" }).ok).toBe(false);
    const light = validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "" });
    expect(light.ok && light.value.theme).toBe("light");
    const yellow = validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "", theme: "yellow" });
    expect(yellow.ok && yellow.value.theme).toBe("yellow");
    const dark = validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "", theme: "dark" });
    expect(dark.ok && dark.value.theme).toBe("dark");
    expect(validateSettings({ timeZone: "", profileLabel: "", sourceOrigin: "", sourcePathPrefix: "", theme: "blue" }).ok).toBe(false);
  });

  it("accepts only extension pages and records a blocked read without a write timestamp", async () => {
    const extensionId = "extensionidexample";
    expect(isTrustedExtensionSender({ id: extensionId, url: `chrome-extension://${extensionId}/src/ui/popup/index.html` }, extensionId)).toBe(true);
    expect(isTrustedExtensionSender({ id: extensionId, url: "https://university.example/schedule" }, extensionId)).toBe(false);

    const store = createMemoryStore();
    const deps = {
      extensionId,
      store,
      getActiveTabUrl: async () => "https://university.example/schedule/week",
      now: () => CAPTURED_AT,
      isLiveAdapterConfigured: () => true,
    };
    const response = await handleMessage({ type: "readActiveTab" }, { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` }, deps);
    expect(response).toMatchObject({ ok: false, code: "timezone_missing" });
    expect(store.snapshot().lastCheckAt).toBe(CAPTURED_AT);
    expect(store.snapshot().lastSuccessfulWriteAt).toBeNull();

    await handleMessage(
      { type: "saveSettings", settings: { timeZone: "Europe/Moscow", profileLabel: "Профиль", groupName: "Группа А-1", sourceOrigin: "https://stud.ibnd.ru", sourcePathPrefix: "" } },
      { id: extensionId, url: `chrome-extension://${extensionId}/options.html` },
      deps,
    );
    const matched = await handleMessage({ type: "readActiveTab" }, { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` }, {
      ...deps,
      getActiveTabUrl: async () => "https://stud.ibnd.ru/",
      isLiveAdapterConfigured: () => true,
      extractSchedule: async () => ({
        status: "ready",
        records: [{ title: "Нарративный дизайн", date: "2026-09-02", startTime: "15:40", endTime: "17:10", room: "236", teacher: "Преподаватель 1" }],
        firstDate: "2026-09-02",
        lastDate: "2026-09-02",
      }),
    });
    expect(matched).toMatchObject({ ok: true, lessonCount: 1 });
    expect(store.snapshot().lastSuccessfulWriteAt).toBeNull();
    expect(store.snapshot().lastSnapshot?.lessons[0]?.start).toBe("2026-09-02T15:40:00+03:00");
    expect(store.snapshot().lastSnapshot?.lessons[0]).toMatchObject({ group: "Группа А-1", lessonType: "оффлайн" });
    const draft = calendarEventDraft(store.snapshot().lastSnapshot?.lessons[0] ?? { title: "" });
    expect(JSON.stringify(draft)).not.toContain("оффлайн");
    expect(draft.description).toContain("Группа А-1");
    expect(JSON.stringify(store.snapshot().lastSnapshot)).not.toContain("://");
    await store.save({ ...store.snapshot(), googleCalendarId: "app@group.calendar.google.com" });
    await handleMessage({ type: "clearLocalData" }, { id: extensionId, url: `chrome-extension://${extensionId}/options.html` }, {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
    });
    expect(store.snapshot().settings.timeZone).toBe("");
    expect(store.snapshot().googleCalendarId).toBe("app@group.calendar.google.com");
    expect(store.snapshot().lastSnapshot).toBeNull();
    expect(await handleMessage({ type: "writeEvent" }, { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` }, {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
    })).toMatchObject({ code: "unknown_message" });
  });
});

describe("stage boundaries", () => {
  it("keeps the real adapter and page reader closed", async () => {
    expect(realUniversityAdapter.configured).toBe(true);
    expect(realUniversityAdapter.canHandle("https://university.example/schedule")).toBe(false);
    expect(realUniversityAdapter.canHandle("https://stud.ibnd.ru/")).toBe(true);
    await expect(realUniversityAdapter.read("https://stud.ibnd.ru/", CAPTURED_AT)).resolves.toMatchObject({
      code: "missing_table",
    });
    expect(mockUniversityAdapter.canHandle("https://university.example/schedule")).toBe(false);
    expect(mockUniversityAdapter.canHandle("mock://fixture/normal-week")).toBe(true);

    const documentProxy = new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(`document.${String(property)} must not be read`);
        },
      },
    ) as Document;
    expect(readPageFailClosed(documentProxy)).toMatchObject({ code: "adapter_not_configured" });
    expect(GOOGLE_WRITES_ENABLED).toBe(false);
    expect(() => googleCalendarWrite()).toThrow(/отключена/);
    expect(canProposeCancellations({
      coverageStatus: "complete",
      sourceKeyMatches: true,
      ownershipProven: true,
      explicitUserConfirmation: false,
    })).toBe(false);
  });

  it("does not contain selectors, html injection, or Google calls", () => {
    const offenders: string[] = [];
    const forbidden = [
      "querySelector",
      "querySelectorAll",
      "getElementsBy",
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "eval(",
      "new Function",
      "getAuthToken",
      "googleapis.com",
      "chrome.cookies",
      "webRequest",
      'type="password"',
    ];
    const scheduleExtractor = resolve(root, "src/adapters/ibnd/extract.ts");
    const googleHttp = resolve(root, "src/calendar/google-http.ts");
    const googleAuth = resolve(root, "src/background/google-auth.ts");
    for (const file of sourceFiles(resolve(root, "src"))) {
      const source = readFileSync(file, "utf8");
      const patterns = forbidden.filter((pattern) => {
        if (file === scheduleExtractor && (pattern === "querySelector" || pattern === "querySelectorAll")) return false;
        if (file === googleHttp && pattern === "googleapis.com") return false;
        if (file === googleAuth && pattern === "getAuthToken") return false;
        return true;
      });
      for (const pattern of patterns) {
        if (source.includes(pattern)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("pins the shared extension id and ignores a private key", () => {
    const vite = readFileSync(resolve(root, "vite.config.ts"), "utf8");
    const publicKey = /key: "([A-Za-z0-9+/=]+)"/.exec(vite)?.[1] ?? "";
    expect(publicKey.length).toBeGreaterThan(100);
    expect(vite).not.toContain("dist.pem");
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe("0.8.3");
    expect(vite).toContain("package.json");
    const hex = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").slice(0, 32);
    const id = [...hex].map((char) => String.fromCharCode(97 + Number.parseInt(char, 16))).join("");
    expect(id).toBe("fgaajikioedkgeddlpfolngopnpkjegm");
    const ignore = readFileSync(resolve(root, ".gitignore"), "utf8");
    expect(ignore).toContain("oauth.public.json");
    expect(ignore).toContain("*.pem");
    expect(ignore).toContain("*.crx");
    const options = readFileSync(resolve(root, "src/ui/options/index.html"), "utf8");
    expect(options).not.toContain('type="password"');
  });
});

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (path.endsWith(".ts") || path.endsWith(".html")) files.push(path);
  }
  return files;
}
