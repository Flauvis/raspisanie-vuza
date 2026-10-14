import { logTechnical } from "../domain/log";
import { parseAppState, STATE_STORAGE_KEY, type StateStore } from "./state";

const DEV_STORAGE_KEY = "ucs.dev.state.v1";

export function hasChromeExtensionApis(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id) && Boolean(chrome.storage?.local);
}

export function createBrowserStore(): StateStore {
  if (hasChromeExtensionApis()) return createChromeStore();
  return createLocalStorageStore();
}

export async function restrictLocalStorageToTrustedContexts(): Promise<void> {
  if (!hasChromeExtensionApis() || typeof chrome.storage.local.setAccessLevel !== "function") return;
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    logTechnical({ code: "storage_access_level_failed" });
  }
}

function createChromeStore(): StateStore {
  return {
    async load() {
      const stored = await chrome.storage.local.get(STATE_STORAGE_KEY);
      return parseAppState(stored[STATE_STORAGE_KEY]);
    },
    async save(state) {
      await chrome.storage.local.set({ [STATE_STORAGE_KEY]: state });
    },
  };
}

function createLocalStorageStore(): StateStore {
  return {
    async load() {
      const raw = localStorage.getItem(DEV_STORAGE_KEY);
      if (!raw) return parseAppState(undefined);
      try {
        return parseAppState(JSON.parse(raw) as unknown);
      } catch {
        return parseAppState(undefined);
      }
    },
    async save(state) {
      localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(state));
    },
  };
}
