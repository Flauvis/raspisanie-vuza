/** @vitest-environment happy-dom */
import { expect, test, vi } from "vitest";
import { checkForUpdate, compareVersions, offerFromRelease } from "../src/update/check";
import { renderUpdateNotice } from "../src/ui/shared/update-notice";

const repository = "owner/schedule";

test("compares dotted versions and ignores the same release", () => {
  expect(compareVersions("0.8.2", "0.8.3")).toBeLessThan(0);
  expect(compareVersions("0.8.10", "0.8.9")).toBeGreaterThan(0);
  expect(compareVersions("0.8.3", "v0.8.3")).toBe(0);
  expect(offerFromRelease("0.8.3", repository, release("v0.8.3"))).toBeNull();
  expect(offerFromRelease("0.8.3", repository, release("v0.8.2"))).toBeNull();
  expect(offerFromRelease("0.8.3", "", release("v0.9.0"))).toBeNull();
});

test("offers the zip on the configured repository and rejects another site", () => {
  expect(offerFromRelease("0.8.2", repository, release("v0.8.4"))).toEqual({
    version: "0.8.4",
    url: "https://github.com/owner/schedule/releases/download/v0.8.4/raspisanie-vuza.zip",
  });
  const foreign = release("v0.8.4");
  const asset = foreign.assets[0];
  if (!asset) throw new Error("fixture");
  asset.browser_download_url = "https://example.invalid/raspisanie-vuza.zip";
  foreign.html_url = "https://example.invalid/releases/v0.8.4";
  expect(offerFromRelease("0.8.2", repository, foreign)).toBeNull();
  const pageOnly = release("v0.8.4");
  pageOnly.assets = [];
  expect(offerFromRelease("0.8.2", repository, pageOnly)).toEqual({
    version: "0.8.4",
    url: "https://github.com/owner/schedule/releases/tag/v0.8.4",
  });
});

test("stays quiet when the request fails and shows a download button for a newer release", async () => {
  const failing = vi.fn(async () => {
    throw new Error("offline");
  });
  await expect(checkForUpdate({ current: "0.8.2", repository, fetchImpl: failing as typeof fetch })).resolves.toBeNull();

  const fetchImpl = vi.fn(async () => Response.json(release("v0.8.4")));
  await expect(checkForUpdate({ current: "0.8.2", repository, fetchImpl: fetchImpl as typeof fetch })).resolves.toEqual({
    version: "0.8.4",
    url: "https://github.com/owner/schedule/releases/download/v0.8.4/raspisanie-vuza.zip",
  });

  const notice = document.createElement("p");
  notice.hidden = true;
  const opened: string[] = [];
  renderUpdateNotice(notice, { version: "0.8.4", url: "https://github.com/owner/schedule/releases/tag/v0.8.4" }, (url) => {
    opened.push(url);
  });
  expect(notice.hidden).toBe(false);
  expect(notice.textContent).toContain("Доступна новая версия 0.8.4");
  expect(notice.querySelector("button")?.textContent).toBe("Скачать");
  notice.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(opened).toEqual(["https://github.com/owner/schedule/releases/tag/v0.8.4"]);
  expect(notice.innerHTML).not.toContain("<a");
});

function release(tag: string): {
  tag_name: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
} {
  return {
    tag_name: tag,
    html_url: `https://github.com/owner/schedule/releases/tag/${tag}`,
    assets: [{
      name: "raspisanie-vuza.zip",
      browser_download_url: `https://github.com/owner/schedule/releases/download/${tag}/raspisanie-vuza.zip`,
    }],
  };
}
