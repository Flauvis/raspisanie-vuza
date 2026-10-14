export type UpdateOffer = {
  version: string;
  url: string;
};

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isUpdateRepository(value: string): boolean {
  return REPOSITORY.test(value);
}

function versionParts(version: string): number[] | null {
  const cleaned = version.trim().replace(/^v/, "");
  if (!/^\d+(?:\.\d+){1,3}$/.test(cleaned)) return null;
  return cleaned.split(".").map((part) => Number(part));
}

export function compareVersions(current: string, latest: string): number | null {
  const left = versionParts(current);
  const right = versionParts(latest);
  if (!left || !right) return null;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function allowedReleaseUrl(url: unknown, repository: string): url is string {
  return typeof url === "string"
    && url.startsWith(`https://github.com/${repository}/releases/`)
    && !/[\s\\]/.test(url);
}

export function offerFromRelease(current: string, repository: string, payload: unknown): UpdateOffer | null {
  if (!isUpdateRepository(repository) || !payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const tag = typeof record.tag_name === "string" ? record.tag_name : "";
  const compared = compareVersions(current, tag);
  if (compared === null || compared >= 0) return null;
  const assets = Array.isArray(record.assets) ? record.assets : [];
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    const item = asset as Record<string, unknown>;
    if (item.name !== "raspisanie-vuza.zip") continue;
    if (allowedReleaseUrl(item.browser_download_url, repository)) {
      return { version: tag.trim().replace(/^v/, ""), url: item.browser_download_url };
    }
  }
  if (!allowedReleaseUrl(record.html_url, repository)) return null;
  return { version: tag.trim().replace(/^v/, ""), url: record.html_url };
}

export async function checkForUpdate(input: {
  current: string;
  repository: string;
  fetchImpl?: typeof fetch;
}): Promise<UpdateOffer | null> {
  if (!isUpdateRepository(input.repository)) return null;
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${input.repository}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return offerFromRelease(input.current, input.repository, await response.json());
  } catch {
    return null;
  }
}
