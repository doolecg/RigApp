import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Seat } from "@rigapp/contracts";
import { browserState } from "./browser.ts";
import { inLinux, platform } from "./setup.ts";
import { settings } from "./settings.ts";

export interface ToolAnswer {
  ok: boolean;
  error?: string;
  data?: unknown;
}

const OFF = "Turn this on in Settings, under Tools, first.";

async function hindsight(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(settings().tools.hindsightUrl.replace(/\/$/, "") + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Hindsight answered ${res.status}.`);
  return res.json();
}

/** Hindsight's memory banks (one per project), for the Memory panel. */
export async function banks(): Promise<ToolAnswer> {
  if (!settings().tools.hindsight) return { ok: false, error: OFF };
  try {
    const body = (await hindsight("/v1/default/banks")) as { banks: { bank_id: string }[] };
    return { ok: true, data: body.banks.map((b) => b.bank_id) };
  } catch (error) {
    return { ok: false, error: `Hindsight is not answering at ${settings().tools.hindsightUrl}: ${(error as Error).message}` };
  }
}

export async function recall(bank: string, query: string): Promise<ToolAnswer> {
  if (!settings().tools.hindsight) return { ok: false, error: OFF };
  try {
    const body = (await hindsight(`/v1/default/banks/${encodeURIComponent(bank)}/memories/recall`, { query })) as {
      results: { id: string; text: string }[];
    };
    return { ok: true, data: body.results.slice(0, 12).map((r) => ({ id: r.id, text: r.text })) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

// The usual homes of OpenAI-compatible servers on one PC; the user can add more in Settings.
const LOCAL_SERVERS = [
  { name: "Ollama", url: "http://localhost:11434" },
  { name: "LM Studio", url: "http://localhost:1234" },
  { name: "llama.cpp", url: "http://localhost:8080" },
];

async function getJson(url: string): Promise<unknown> {
  // A server that is not running refuses at once; a short timeout covers one that hangs.
  const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  return res.json();
}

/** Model names from `/v1/models`, the route every OpenAI-compatible server has; Ollama's own `/api/tags` as a second try. */
async function listModels(base: string, ollama: boolean): Promise<string[] | null> {
  try {
    const body = (await getJson(`${base}/v1/models`)) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id);
  } catch {
    if (!ollama) return null;
  }
  try {
    const body = (await getJson(`${base}/api/tags`)) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

/** Local model servers that answer right now, with the models each lists. Reads only; changes nothing. */
export async function localModels(): Promise<ToolAnswer> {
  const known = new Set(LOCAL_SERVERS.map((s) => s.url));
  const extra = settings().tools.localModels.flatMap((address) => {
    // Accept "host:port" and an address ending in /v1; keep only the server's base.
    const base = address.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
    return base && !known.has(base) ? [{ name: "Custom", url: /^https?:\/\//.test(base) ? base : `http://${base}` }] : [];
  });
  const found = await Promise.all(
    [...LOCAL_SERVERS, ...extra].map(async (s) => {
      const models = await listModels(s.url, s.name === "Ollama");
      return models ? { ...s, models } : null;
    }),
  );
  return { ok: true, data: found.filter((s) => s !== null) };
}

/**
 * Whether seats can reach Hindsight through mcptoon: the CLI where seats run (inside WSL
 * on Windows) and a `hindsight` server in its config. Seats then call tools from Bash,
 * so no tool list sits in their context on every turn.
 */
export async function seatTools(distro: string | null): Promise<ToolAnswer> {
  const last = (out: string) => out.split("\n").pop()?.trim() ?? "";
  // CodeGraph is a plain CLI seats can call; check it from a Windows drive, where it works.
  const codegraph = await inLinux(distro, ["bash", "-lc", "cd /mnt/c 2>/dev/null; codegraph --version"]);
  const cg = codegraph.ok ? last(codegraph.out) : null;
  const version = await inLinux(distro, ["bash", "-lc", "mcptoon --version"]);
  const browser = browserState().url;
  if (!version.ok) return { ok: true, data: { mcptoon: null, hindsight: false, codegraph: cg, browser } };
  const list = await inLinux(distro, ["bash", "-lc", "mcptoon list"]);
  return { ok: true, data: { mcptoon: last(version.out), hindsight: /^\s*hindsight\s/m.test(list.out), codegraph: cg, browser } };
}

/** A seat folder on this machine: /mnt/e/x is E:\x on Windows; other WSL paths go through \\wsl.localhost. */
function localFolder(cwd: string, distro: string | null): string {
  if (platform !== "windows") return cwd;
  const drive = /^\/mnt\/([a-z])(\/.*)?$/.exec(cwd);
  if (drive) return `${drive[1]!.toUpperCase()}:${(drive[2] ?? "\\").replaceAll("/", "\\")}`;
  return distro ? `\\\\wsl.localhost\\${distro}${cwd.replaceAll("/", "\\")}` : cwd;
}

/**
 * How to run the codegraph CLI without a shell, so the search text is never read as
 * shell syntax. On Windows npm installs a .cmd wrapper; run its Node script directly.
 */
function codegraphCommand(): [string, string[]] | null {
  if (platform !== "windows") return ["codegraph", []];
  const npm = join(process.env.APPDATA ?? "", "npm");
  const shim = join(npm, "node_modules", "@colbymchenry", "codegraph", "npm-shim.js");
  if (existsSync(shim)) return [process.execPath, [shim]];
  const found = (process.env.PATH ?? "").split(";").map((dir) => join(dir, "node_modules", "@colbymchenry", "codegraph", "npm-shim.js")).find(existsSync);
  return found ? [process.execPath, [found]] : null;
}

/** `codegraph explore <query>` in the seat's folder: CodeGraph finds the nearest index above it. */
export function explore(seat: Seat, distro: string | null, query: string): Promise<ToolAnswer> {
  if (!settings().tools.codegraph) return Promise.resolve({ ok: false, error: OFF });
  if (!seat.cwd) return Promise.resolve({ ok: false, error: "OpenRig reports no folder for this seat." });
  const command = codegraphCommand();
  if (!command) return Promise.resolve({ ok: false, error: "The codegraph command is not installed (npm install -g @colbymchenry/codegraph)." });
  const [cmd, base] = command;
  const cwd = localFolder(seat.cwd, distro);
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...base, "explore", query],
      { cwd, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
      (err, stdout, stderr) => {
        if (err && !stdout) resolve({ ok: false, error: String(stderr).trim() || err.message });
        else resolve({ ok: true, data: { folder: cwd, text: String(stdout).slice(0, 60000) } });
      },
    );
  });
}
