import { clear, el, setText } from "../shared/dom";
import type { ReviewView } from "./view";

const COLUMNS = [
  "Дисциплина",
  "Дата",
  "Начало",
  "Окончание",
  "Аудитория",
  "Преподаватель",
  "Группа",
  "Тип",
  "Идентификация",
] as const;

export function renderReview(root: HTMLElement, view: ReviewView): void {
  clear(root);
  const facts = el("dl");
  facts.append(
    fact("Период", view.coverageText),
    fact("Полнота", view.coverageStatusLabel),
    fact("Часовой пояс набора", view.timeZone),
    fact("Контрольная сумма", view.snapshotHash ? view.snapshotHash.slice(0, 12) : "—"),
  );
  root.append(facts);

  const warningTitle = el("h2", "Предупреждения");
  root.append(warningTitle);
  if (view.warnings.length === 0) {
    root.append(el("p", "Предупреждений нет.", "muted"));
  } else {
    for (const warning of view.warnings) root.append(el("p", warning, view.kind === "unavailable" ? "error" : "warning"));
  }

  root.append(el("h2", "Занятия"));
  if (view.rows.length === 0) {
    root.append(el("p", view.emptyText, "muted"));
  } else {
    root.append(renderTable(view));
  }

  root.append(el("p", view.cancellationNote, "hint"));
  root.append(el("p", "После сравнения можно записать все пары снимка. Одна самая ранняя пара по-прежнему записывается отдельно. Тип пары в событие не входит. Пропавшие пары удаляются только кнопкой «Подтвердить отмены», и только если снимок полный.", "hint"));
}

function fact(label: string, value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(el("dt", label), el("dd", value));
  return fragment;
}

function renderTable(view: ReviewView): HTMLDivElement {
  const wrap = el("div", undefined, "table-wrap");
  const table = el("table");
  const caption = el("caption", "Найденные занятия");
  caption.hidden = true;
  const head = el("thead");
  const headRow = el("tr");
  for (const column of COLUMNS) headRow.append(el("th", column));
  head.append(headRow);
  const body = el("tbody");
  for (const row of view.rows) {
    const tr = el("tr");
    for (const value of [row.title, row.date, row.start, row.end, row.room, row.teacher, row.group, row.lessonType, row.identity]) {
      tr.append(el("td", value));
    }
    body.append(tr);
  }
  table.append(caption, head, body);
  wrap.append(table);
  setText(caption, "Найденные занятия");
  return wrap;
}
