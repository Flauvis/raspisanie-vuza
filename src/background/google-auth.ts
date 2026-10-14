import type { TokenProvider } from "../calendar/google-http";
import { logTechnical } from "../domain/log";

export function chromeTokenProvider(): TokenProvider {
  return {
    token(interactive) {
      return requestToken(interactive);
    },
    async forget(token) {
      await new Promise<void>((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      });
    },
  };
}

export function signInFromUserGesture(done: (ok: boolean) => void): void {
  const request = () => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      const failed = Boolean(chrome.runtime.lastError) || !token;
      logTechnical({ code: failed ? "google_auth_interactive_failed" : "google_auth_interactive_ok" });
      done(!failed);
    });
  };
  if (chrome.identity.clearAllCachedAuthTokens) {
    chrome.identity.clearAllCachedAuthTokens(() => request());
    return;
  }
  request();
}

export function ensureAuthTokenFromGesture(done: (ok: boolean) => void): void {
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    const failed = Boolean(chrome.runtime.lastError) || !token;
    logTechnical({ code: failed ? "google_auth_interactive_failed" : "google_auth_interactive_ok" });
    done(!failed);
  });
}

function requestToken(interactive: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        logTechnical({ code: interactive ? "google_auth_interactive_failed" : "google_auth_silent_failed" });
        resolve(null);
        return;
      }
      resolve(token);
    });
  });
}
