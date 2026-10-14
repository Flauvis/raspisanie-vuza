import { EXTENSION_VERSION, UPDATE_REPOSITORY } from "../../update/config";
import { checkForUpdate, type UpdateOffer } from "../../update/check";
import { clear, el } from "./dom";

export function renderUpdateNotice(notice: HTMLElement, offer: UpdateOffer, open: (url: string) => void): void {
  clear(notice);
  notice.append(el("span", `Доступна новая версия ${offer.version}.`));
  const button = el("button", "Скачать", "secondary");
  button.type = "button";
  button.addEventListener("click", () => {
    open(offer.url);
  });
  notice.append(button);
  notice.hidden = false;
}

export function watchUpdate(): void {
  const notice = document.getElementById("update-notice");
  if (!(notice instanceof HTMLElement) || !UPDATE_REPOSITORY) return;
  void checkForUpdate({ current: installedVersion(), repository: UPDATE_REPOSITORY }).then((offer) => {
    if (!offer || !notice.isConnected) return;
    renderUpdateNotice(notice, offer, openUpdate);
  });
}

function installedVersion(): string {
  if (typeof chrome !== "undefined" && typeof chrome.runtime?.getManifest === "function") {
    try {
      return chrome.runtime.getManifest().version || EXTENSION_VERSION;
    } catch {
      return EXTENSION_VERSION;
    }
  }
  return EXTENSION_VERSION;
}

function openUpdate(url: string): void {
  if (typeof chrome !== "undefined" && chrome.runtime?.id && chrome.tabs?.create) {
    chrome.tabs.create({ url });
    return;
  }
  window.open(url, "_blank", "noopener");
}
