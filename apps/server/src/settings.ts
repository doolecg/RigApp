import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Settings } from "@rigapp/contracts";

// The desktop app passes its user data folder; a plain `pnpm start` uses ~/.rigapp.
const DIR = process.env.RIGAPP_DATA_DIR ?? join(homedir(), ".rigapp");
const FILE = join(DIR, "settings.json");

const DEFAULTS: Settings = {
  theme: "system",
  daemonUrl: "",
  keybindings: {},
  tools: { hindsight: false, hindsightUrl: "http://localhost:8888", codegraph: false, browser: false },
};

let current: Settings = DEFAULTS;

export async function loadSettings(): Promise<Settings> {
  try {
    const saved = JSON.parse(await readFile(FILE, "utf8")) as Partial<Settings>;
    current = { ...DEFAULTS, ...saved, tools: { ...DEFAULTS.tools, ...saved.tools } };
  } catch {
    current = DEFAULTS;
  }
  return current;
}

export function settings(): Settings {
  return current;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  current = {
    ...current,
    ...patch,
    keybindings: { ...current.keybindings, ...patch.keybindings },
    tools: { ...current.tools, ...patch.tools },
  };
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(current, null, 2) + "\n");
  return current;
}
