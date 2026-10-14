import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function readUpdateRepository(root) {
  const path = join(root, "update.public.json");
  if (!existsSync(path)) return "";
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("update.public.json не читается");
  }
  const repository = typeof parsed.repository === "string" ? parsed.repository.trim() : "";
  if (!repository) return "";
  if (!REPOSITORY.test(repository)) {
    throw new Error("update.public.json: поле repository должно быть вида owner/name");
  }
  return repository;
}
