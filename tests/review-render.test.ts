/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { previewFixture } from "../src/adapters/mock/adapter";
import { getFixture } from "../src/adapters/mock/catalog";
import { renderReview } from "../src/ui/review/render";
import { toReviewView } from "../src/ui/review/view";
import { CAPTURED_AT } from "./helpers";

describe("review rendering", () => {
  it("shows lesson text without creating html elements from the title", async () => {
    const fixture = getFixture("html-title");
    if (!fixture) throw new Error("missing fixture");
    const result = await previewFixture(fixture, CAPTURED_AT);
    const root = document.createElement("section");
    renderReview(root, toReviewView(result));

    const cell = root.querySelector("tbody td");
    expect(cell?.textContent).toBe("<img src=x onerror=alert(1)>Дисциплина");
    expect(cell?.querySelector("img")).toBeNull();
    expect(root.querySelector("script")).toBeNull();
    expect(root.innerHTML).toContain("&lt;img");
    expect(root.textContent).toContain("Аудитория");
    expect(root.textContent).toContain("<b>404</b>");
  });

  it("renders the normal week and an unavailable source", async () => {
    const week = getFixture("normal-week");
    const loggedOut = getFixture("logged-out");
    if (!week || !loggedOut) throw new Error("missing fixture");
    const weekRoot = document.createElement("section");
    renderReview(weekRoot, toReviewView(await previewFixture(week, CAPTURED_AT)));
    expect(weekRoot.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(weekRoot.textContent).toContain("Аудитория не указана");
    expect(weekRoot.textContent).toContain("Полный период");

    const emptyRoot = document.createElement("section");
    renderReview(emptyRoot, toReviewView(await previewFixture(loggedOut, CAPTURED_AT)));
    expect(emptyRoot.querySelector("tbody")).toBeNull();
    expect(emptyRoot.textContent).not.toContain("Игнорируемая пара");
    expect(emptyRoot.textContent).toContain("не отменяются");
  });
});
