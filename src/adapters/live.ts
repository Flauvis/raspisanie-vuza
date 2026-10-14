import { canHandleIbnd } from "./ibnd/adapter";

export function isLiveAdapterConfigured(url: string | undefined): boolean {
  if (!url) return false;
  return canHandleIbnd(url);
}
