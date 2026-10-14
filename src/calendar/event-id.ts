import { sha256Hex } from "../domain/canonical";

export function googleEventId(uuid: string): string | null {
  const compact = uuid.trim().toLowerCase().replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(compact)) return null;
  return compact;
}

export async function lessonEventId(lessonKey: string): Promise<string> {
  return sha256Hex(`event:${lessonKey}`);
}
