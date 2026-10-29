import { useState, useSyncExternalStore } from "react";

/** State kept in localStorage, so panel sizes and toggles survive a reload. */
export function useStored<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved == null ? initial : (JSON.parse(saved) as T);
    } catch {
      // Saved by an older build in another format.
      return initial;
    }
  });
  return [
    value,
    (next: T) => {
      localStorage.setItem(key, JSON.stringify(next));
      setValue(next);
    },
  ];
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    () => matchMedia(query).matches,
  );
}
