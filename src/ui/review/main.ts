import { IBND_SOURCE_KEY } from "../../adapters/ibnd/extract";
import { OAUTH_CLIENT_CONFIGURED } from "../../calendar/oauth-config";
import { listFixtures } from "../../adapters/mock/catalog";
import { previewFixture } from "../../adapters/mock/adapter";
import { hasChromeExtensionApis, createBrowserStore } from "../../storage/browser-store";
import { clear, el, requireElement, setText } from "../shared/dom";
import { watchUpdate } from "../shared/update-notice";
import { renderReview } from "./render";
import { toReviewView } from "./view";
import { applyTheme, readBootTheme } from "../shared/theme";
import "../shared/app.css";

applyTheme(readBootTheme());
const store = createBrowserStore();
const fixtures = listFixtures();
const select = requireElement<HTMLSelectElement>("fixture");
const description = requireElement<HTMLParagraphElement>("fixture-description");
const result = requireElement<HTMLElement>("result");
const devBanner = requireElement<HTMLParagraphElement>("dev-banner");
const compareButton = requireElement<HTMLButtonElement>("compare");
const confirmButton = requireElement<HTMLButtonElement>("confirm");
const createCalendarButton = requireElement<HTMLButtonElement>("create-calendar");
const syncCompareButton = requireElement<HTMLButtonElement>("sync-compare");
const syncConfirmButton = requireElement<HTMLButtonElement>("sync-confirm");
const cancelConfirmButton = requireElement<HTMLButtonElement>("cancel-confirm");
const writeHint = requireElement<HTMLParagraphElement>("write-hint");
const calendarChoices = requireElement<HTMLDivElement>("calendar-choices");
let pendingHash = "";
let pendingCreate = false;
let pendingSyncHash = "";

compareButton.disabled = !hasChromeExtensionApis() || !OAUTH_CLIENT_CONFIGURED;
confirmButton.disabled = true;
createCalendarButton.disabled = true;
syncCompareButton.disabled = !hasChromeExtensionApis() || !OAUTH_CLIENT_CONFIGURED;
syncConfirmButton.disabled = true;
cancelConfirmButton.disabled = true;
compareButton.addEventListener("click", () => {
  void dryRun();
});
confirmButton.addEventListener("click", () => {
  void confirm(pendingCreate);
});
createCalendarButton.addEventListener("click", () => {
  void confirm(true);
});
syncCompareButton.addEventListener("click", () => {
  void planAll();
});
syncConfirmButton.addEventListener("click", () => {
  void confirmAll();
});
cancelConfirmButton.addEventListener("click", () => {
  void confirmCancellations();
});

if (!hasChromeExtensionApis()) {
  devBanner.hidden = false;
  setText(
    devBanner,
    "Проверка интерфейса вне установленного расширения. Данные этой страницы лежат в localStorage и не являются данными Chrome.",
  );
}

const liveOption = el("option", "Последнее чтение с сайта");
liveOption.value = "live";
select.append(liveOption);
for (const fixture of fixtures) {
  select.append(el("option", fixture.title));
  const option = select.options[select.options.length - 1];
  if (option) option.value = fixture.id;
}

select.addEventListener("change", () => {
  void showFixture(select.value);
});

void restoreSelection();
watchUpdate();

async function restoreSelection(): Promise<void> {
  const state = await store.load();
  applyTheme(state.settings.theme, true);
  const saved = state.lastPreviewFixtureId === "live" || fixtures.some((fixture) => fixture.id === state.lastPreviewFixtureId)
    ? state.lastPreviewFixtureId
    : fixtures[0]?.id;
  if (!saved) return;
  select.value = saved;
  await showFixture(saved);
}

async function showFixture(id: string): Promise<void> {
  if (id === "live") {
    const state = await store.load();
    if (!state.lastSnapshot || state.lastSnapshot.sourceKey !== IBND_SOURCE_KEY) {
      setText(description, "С сайта ещё ничего не прочитано. Откройте stud.ibnd.ru и нажмите «Считать расписание».");
      renderReview(result, toReviewView({
        kind: "unavailable",
        code: "not_read",
        message: "Таблица с сайта ещё не прочитана.",
        coverageStatus: "unknown",
      }));
      return;
    }
    setText(description, "Последнее чтение таблицы на stud.ibnd.ru. Пояс Europe/Moscow. Запись в календарь выключена.");
    renderReview(result, toReviewView({ kind: "snapshot", snapshot: state.lastSnapshot }));
    return;
  }
  const fixture = fixtures.find((item) => item.id === id);
  if (!fixture) return;
  setText(description, `${fixture.description} Пояс набора: ${fixture.timeZone}.`);
  const read = await previewFixture(fixture, new Date().toISOString());
  renderReview(result, toReviewView(read));
  const state = await store.load();
  await store.save({
    ...state,
    lastPreviewFixtureId: fixture.id,
    lastSnapshot: read.kind === "snapshot" ? read.snapshot : null,
    lastRead:
      read.kind === "unavailable"
        ? { code: read.code, message: read.message, at: new Date().toISOString() }
        : state.lastRead,
  });
}

async function dryRun(): Promise<void> {
  if (!hasChromeExtensionApis() || compareButton.disabled) return;
  confirmButton.disabled = true;
  createCalendarButton.disabled = true;
  pendingHash = "";
  clear(calendarChoices);
  const response = await chrome.runtime.sendMessage({ type: "dryRunGoogle" });
  const message = textField(response, "message") ?? "Просмотр не выполнен.";
  setText(writeHint, message);
  pendingHash = textField(response, "snapshotHash") ?? "";
  pendingCreate = booleanField(response, "createCalendar");
  confirmButton.disabled = !booleanField(response, "canConfirm") || !pendingHash;
  const calendars = arrayField(response);
  if (!booleanField(response, "canConfirm") && calendars.length > 0) {
    createCalendarButton.disabled = false;
    for (const calendar of calendars) {
      const button = el("button", calendar.summary, "secondary");
      button.type = "button";
      button.addEventListener("click", () => {
        void chooseCalendar(calendar.id);
      });
      calendarChoices.append(button);
    }
  }
}

async function chooseCalendar(calendarId: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "chooseGoogleCalendar", calendarId });
  setText(writeHint, textField(response, "message") ?? "Календарь не выбран.");
  if (response && typeof response === "object" && "ok" in response && response.ok === true) await dryRun();
}

async function confirm(createCalendar: boolean): Promise<void> {
  if (!pendingHash || (confirmButton.disabled && !createCalendar)) return;
  confirmButton.disabled = true;
  createCalendarButton.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "confirmTestEvent", snapshotHash: pendingHash, createCalendar });
  setText(writeHint, textField(response, "message") ?? "Запись не выполнена.");
}

async function planAll(): Promise<void> {
  if (!hasChromeExtensionApis() || syncCompareButton.disabled) return;
  syncConfirmButton.disabled = true;
  cancelConfirmButton.disabled = true;
  pendingSyncHash = "";
  const response = await chrome.runtime.sendMessage({ type: "planSync" });
  setText(writeHint, textField(response, "message") || "Сравнение не выполнено.");
  pendingSyncHash = textField(response, "snapshotHash");
  syncConfirmButton.disabled = !booleanField(response, "canConfirm") || !pendingSyncHash;
  cancelConfirmButton.disabled = !booleanField(response, "canCancel") || !pendingSyncHash;
}

async function confirmAll(): Promise<void> {
  if (!pendingSyncHash || syncConfirmButton.disabled) return;
  syncConfirmButton.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "confirmSync", snapshotHash: pendingSyncHash });
  setText(writeHint, textField(response, "message") || "Запись не выполнена.");
}

async function confirmCancellations(): Promise<void> {
  if (!pendingSyncHash || cancelConfirmButton.disabled) return;
  const approved = window.confirm("Удалить из календаря пары, которых нет в полном снимке? Вернуть их будет нельзя.");
  if (!approved) return;
  cancelConfirmButton.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "confirmCancellations", snapshotHash: pendingSyncHash });
  setText(writeHint, textField(response, "message") || "Отмена не выполнена.");
}

function textField(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : "";
}

function booleanField(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>)[key] === true;
}

function arrayField(value: unknown): { id: string; summary: string }[] {
  if (!value || typeof value !== "object") return [];
  const field = (value as { calendars?: unknown }).calendars;
  if (!Array.isArray(field)) return [];
  return field.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = (item as { id?: unknown }).id;
    const summary = (item as { summary?: unknown }).summary;
    if (typeof id !== "string" || typeof summary !== "string") return [];
    return [{ id, summary }];
  });
}
