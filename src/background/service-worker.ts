import { extractIbndSchedule, sanitizeIbndExtract, type IbndExtractResult } from "../adapters/ibnd/extract";
import { createGoogleCalendarApi } from "../calendar/google-api";
import { googleEventId } from "../calendar/event-id";
import { OAUTH_CLIENT_CONFIGURED } from "../calendar/oauth-config";
import { logTechnical } from "../domain/log";
import { restrictLocalStorageToTrustedContexts, createBrowserStore } from "../storage/browser-store";
import { chromeTokenProvider } from "./google-auth";
import { handleMessage } from "./handle-message";

const store = createBrowserStore();
const googleTokens = chromeTokenProvider();
const calendarApi = createGoogleCalendarApi({ tokens: googleTokens });

void restrictLocalStorageToTrustedContexts();
chrome.runtime.onInstalled.addListener(() => {
  void restrictLocalStorageToTrustedContexts();
});
chrome.runtime.onStartup.addListener(() => {
  void restrictLocalStorageToTrustedContexts();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender, {
    extensionId: chrome.runtime.id,
    store,
    getActiveTabUrl: activeTabUrl,
    now: () => new Date().toISOString(),
    extractSchedule: readActiveSchedule,
    oauthConfigured: OAUTH_CLIENT_CONFIGURED,
    authorizeInteractive: async () => Boolean(await googleTokens.token(true)),
    calendarApi,
    newEventId: () => googleEventId(crypto.randomUUID()),
    openCalendar: async (url) => {
      await chrome.tabs.create({ url });
    },
  }).then(sendResponse, () => {
    logTechnical({ code: "message_handler_failed" });
    sendResponse({ ok: false, code: "internal_error", message: "Не удалось выполнить действие." });
  });
  return true;
});

async function activeTabUrl(): Promise<string | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url;
}

async function readActiveSchedule(): Promise<IbndExtractResult> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) return { status: "inject_failed", records: [] };
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractIbndSchedule,
    });
    return sanitizeIbndExtract(injected[0]?.result);
  } catch {
    logTechnical({ code: "schedule_extract_failed" });
    return { status: "inject_failed", records: [] };
  }
}

