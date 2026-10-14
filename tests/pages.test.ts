/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, vi } from "vitest";

function mount(relativePath: string): void {
  const html = readFileSync(resolve(relativePath), "utf8");
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? "";
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/gi, "");
}

test("preview page lists the week, escapes html, and keeps calendar actions off", async () => {
  localStorage.clear();
  mount("src/ui/review/index.html");
  await import("../src/ui/review/main");

  await vi.waitFor(() => {
    expect(document.querySelectorAll("#result tbody tr")).toHaveLength(5);
  });
  expect(document.body.textContent).toContain("Математический анализ");
  expect(document.body.textContent).toContain("Аудитория не указана");
  expect(document.body.textContent).toContain("Europe/Moscow");
  expect((document.getElementById("compare") as HTMLButtonElement).disabled).toBe(true);
  expect((document.getElementById("confirm") as HTMLButtonElement).disabled).toBe(true);
  expect((document.getElementById("cancel-confirm") as HTMLButtonElement).disabled).toBe(true);

  const select = document.getElementById("fixture") as HTMLSelectElement;
  select.value = "html-title";
  select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>Дисциплина");
  });
  expect(document.querySelector("#result img")).toBeNull();
  expect(document.querySelector("#result script")).toBeNull();

  select.value = "logged-out";
  select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain("Сессия кабинета не активна");
  });
  expect(document.body.textContent).not.toContain("Игнорируемая пара");
  expect(document.querySelector("#result tbody")).toBeNull();
  await vi.waitFor(() => {
    expect(localStorage.getItem("ucs.dev.state.v1")).toContain("logged-out");
  });
});

test("options page saves an explicit university time zone", async () => {
  localStorage.clear();
  mount("src/ui/options/index.html");
  await import("../src/ui/options/main");
  const timezone = document.getElementById("timezone") as HTMLInputElement;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(timezone.value).toBe("");
  timezone.value = "Europe/Moscow";
  const group = document.getElementById("group") as HTMLInputElement;
  expect(group).not.toBeNull();
  group.value = "Группа А-1";
  document.getElementById("settings")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => {
    expect(document.getElementById("settings-message")?.textContent).toContain("Настройки сохранены");
  });
  expect(localStorage.getItem("ucs.dev.state.v1")).toContain("Europe/Moscow");
  expect(localStorage.getItem("ucs.dev.state.v1")).toContain("Группа А-1");
  expect(localStorage.getItem("ucs.dev.state.v1")).toContain('"openCalendarAfterWrite":false');
  const openCalendar = document.getElementById("open-calendar") as HTMLInputElement;
  expect(openCalendar.checked).toBe(false);
  openCalendar.checked = true;
  const blue = document.querySelector("input[name='calendar-color'][value='16']") as HTMLInputElement;
  expect(blue).not.toBeNull();
  blue.checked = true;
  blue.dispatchEvent(new Event("change"));
  document.getElementById("settings")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => {
    expect(localStorage.getItem("ucs.dev.state.v1")).toContain('"openCalendarAfterWrite":true');
    expect(localStorage.getItem("ucs.dev.state.v1")).toContain('"calendarColorId":"16"');
  });
  expect((document.getElementById("google") as HTMLButtonElement).disabled).toBe(true);
  const deleteCalendar = document.getElementById("delete-calendar") as HTMLButtonElement;
  expect(deleteCalendar.textContent).toContain("Удалить календарь");
  expect(deleteCalendar.disabled).toBe(true);
  expect(document.getElementById("calendar-candidates")?.hasAttribute("hidden")).toBe(true);
  expect(document.body.textContent).toContain("Номер календаря");
  expect(document.body.textContent).toContain("не кнопкой");
  expect(document.body.textContent).toContain("Test users");
  expect(document.body.textContent).toContain("stud.ibnd.ru");
  expect(document.querySelectorAll("input[name='theme']")).toHaveLength(3);
  const yellow = document.getElementById("theme-yellow") as HTMLInputElement;
  yellow.checked = true;
  yellow.dispatchEvent(new Event("change"));
  expect(document.documentElement.dataset.theme).toBe("yellow");
  document.getElementById("settings")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => {
    expect(localStorage.getItem("ucs.dev.state.v1")).toContain('"theme":"yellow"');
  });
});

test("popup blocks reading and does not claim a successful write", async () => {
  localStorage.clear();
  mount("src/ui/popup/index.html");
  await import("../src/ui/popup/main");
  expect(document.getElementById("google")?.textContent).toContain("Не подключено");
  expect(document.getElementById("last-write")?.textContent).toBe("Ещё не было");
  await vi.waitFor(() => {
    expect(document.getElementById("message")?.textContent).toContain("stud.ibnd.ru");
  });
  document.getElementById("read")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => {
    expect(document.getElementById("message")?.textContent).toContain("Укажите часовой пояс вуза");
  });
  expect(document.body.textContent).not.toContain("синхронизировано");
  expect(document.getElementById("last-write")?.textContent).toBe("Ещё не было");
});
