import { useSyncExternalStore } from "react";
import type { Seat, Shell } from "@rigapp/contracts";

// When you last looked at each seat's thread, kept in this browser. A seat whose
// daemon `lastActivityAt` is newer has something you have not seen.
const KEY = "rigapp.seen";

let seen: Record<string, string> | null = null;
const listeners = new Set<() => void>();

function load(): Record<string, string> | null {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? (JSON.parse(saved) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

function save(next: Record<string, string>) {
  seen = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

/** On the very first run, count everything as seen so old history is not all "new". */
export function initSeen(shell: Shell) {
  if (localStorage.getItem(KEY)) return;
  const now = new Date().toISOString();
  save(Object.fromEntries(shell.projects.flatMap((p) => p.pods.flatMap((pod) => pod.seats.map((s) => [s.session, now])))));
}

export function markSeen(session: string) {
  save({ ...(seen ?? {}), [session]: new Date().toISOString() });
}

export function useSeen(): Record<string, string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (seen ??= load() ?? {}),
  );
}

export function isUnread(seat: Seat, seenMap: Record<string, string>): boolean {
  if (!seat.lastActivityAt) return false;
  const at = seenMap[seat.session];
  return !at || seat.lastActivityAt > at;
}
