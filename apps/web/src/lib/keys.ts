import type { Settings } from "@rigapp/contracts";

/** Every rebindable shortcut. `mod` is Ctrl on Windows and Linux, Cmd on a Mac. */
export const COMMANDS = [
  { id: "palette", label: "Open the command palette", key: "mod+k" },
  { id: "overview", label: "Open Overview", key: "mod+shift+o" },
  { id: "sidebar", label: "Show or hide the sidebar", key: "mod+b" },
  { id: "details", label: "Show or hide seat details", key: "mod+j" },
  { id: "settings", label: "Open Settings", key: "mod+," },
  { id: "tab.chat", label: "Chat tab", key: "mod+1" },
  { id: "tab.graph", label: "Graph tab", key: "mod+2" },
  { id: "tab.terminal", label: "Terminal tab", key: "mod+3" },
  { id: "tab.specs", label: "Specs tab", key: "mod+4" },
] as const;

export type CommandId = (typeof COMMANDS)[number]["id"];

const mac = navigator.platform.toLowerCase().includes("mac");

/** The key combination of a keydown, written the way bindings are stored, e.g. "mod+shift+k". */
export function comboOf(event: KeyboardEvent): string | null {
  const key = event.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(key)) return null;
  const parts = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

export function bindings(settings: Settings): Record<CommandId, string> {
  return Object.fromEntries(COMMANDS.map((c) => [c.id, settings.keybindings[c.id] ?? c.key])) as Record<CommandId, string>;
}

/** How a binding reads on screen, e.g. "Ctrl+Shift+K". */
export function label(combo: string): string {
  return combo
    .split("+")
    .map((p) => (p === "mod" ? (mac ? "Cmd" : "Ctrl") : p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1)))
    .join("+");
}
