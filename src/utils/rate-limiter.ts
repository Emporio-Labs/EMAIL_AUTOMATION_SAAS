// Per-tenant sliding one-minute window for API-key sends.
// In-process: correct for a single API instance (the EC2 setup). If the API is
// ever scaled to several instances, move this to Redis or Postgres.

const WINDOW_MS = 60_000;
const windows = new Map<string, Array<{ at: number; count: number }>>();

export function tryConsume(tenantId: string, count: number, limitPerMinute: number, now = Date.now()): boolean {
  const entries = (windows.get(tenantId) ?? []).filter((entry) => now - entry.at < WINDOW_MS);
  const used = entries.reduce((sum, entry) => sum + entry.count, 0);

  if (used + count > limitPerMinute) {
    windows.set(tenantId, entries);
    return false;
  }

  entries.push({ at: now, count });
  windows.set(tenantId, entries);
  return true;
}

export function resetRateLimits(): void {
  windows.clear();
}
