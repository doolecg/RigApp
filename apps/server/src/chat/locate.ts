import { homedir } from "node:os";
import { join } from "node:path";
import { open, readdir, readFile, stat } from "node:fs/promises";
import type { Seat } from "@rigapp/contracts";
import { inLinux } from "../setup.ts";
import { OpenCodeSource, opencodeFile } from "./opencode.ts";
import type { ChatFormat } from "./source.ts";

export interface Located {
  format: ChatFormat;
  /** What a `Thread` reads: a JSONL path, or `<database>#<session id>` for OpenCode. */
  file: string;
}

/** How a seat's runtime is read, or null when RigApp has no reader for it. */
export function formatOf(runtime: string): ChatFormat | null {
  if (runtime === "claude-code") return "claude";
  if (runtime === "codex") return "codex";
  if (/^pi(-|$)/.test(runtime)) return "pi";
  // Community harnesses are named by whoever wrote the preset, so match on the name.
  if (/opencode/i.test(runtime)) return "opencode";
  if (/antigravity|^agy/i.test(runtime)) return "antigravity";
  return null;
}

/** Compares folders as the harnesses write them: `/mnt/e/x`, `E:\x` and `e:/x/` are the same place. */
export function sameDir(a: string, b: string): boolean {
  const norm = (dir: string) =>
    dir
      .replaceAll("\\", "/")
      .replace(/^\/mnt\/([a-z])\//i, "$1:/")
      .replace(/\/+$/, "")
      .toLowerCase();
  return norm(a) === norm(b);
}

const homes = new Map<string | null, Promise<string>>();

/** The Linux user's home on the side the seats run on (inside WSL on Windows). */
function linuxHome(distro: string | null): Promise<string> {
  let home = homes.get(distro);
  if (!home) {
    home = distro ? inLinux(distro, ["sh", "-c", "echo $HOME"]).then((r) => r.out || "/root") : Promise.resolve(homedir());
    homes.set(distro, home);
  }
  return home;
}

/** Newest first. Session file names start with a timestamp, so the name order is the time order. */
async function newestFirst(dir: string, keep: (name: string) => boolean): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter(keep).sort().reverse();
}

/** The first line of a JSONL file (a Codex `session_meta` can be large, but not beyond this). */
async function firstLine(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead).split("\n")[0] ?? "";
  } finally {
    await handle.close();
  }
}

/** Codex files its rollouts by date; the newest one whose `session_meta` names the seat's folder is its session. */
async function findCodex(root: string, cwd: string): Promise<string | null> {
  const sessions = join(root, ".codex", "sessions");
  let checked = 0;
  for (const year of await newestFirst(sessions, (n) => /^\d{4}$/.test(n)))
    for (const month of await newestFirst(join(sessions, year), (n) => /^\d\d$/.test(n)))
      for (const day of await newestFirst(join(sessions, year, month), (n) => /^\d\d$/.test(n))) {
        const dir = join(sessions, year, month, day);
        for (const name of await newestFirst(dir, (n) => /^rollout-.*\.jsonl$/.test(n))) {
          if (++checked > 40) return null;
          try {
            const meta = JSON.parse(await firstLine(join(dir, name)));
            if (typeof meta.payload?.cwd === "string" && sameDir(meta.payload.cwd, cwd)) return join(dir, name);
          } catch {
            // A rollout still being created: the next poll finds it.
          }
        }
      }
  return null;
}

/** The managed Pi runtime keeps each seat's sessions in `<OpenRig home>/state/pi/<session>/sessions`. */
async function findPi(root: string, runtime: string, session: string): Promise<string | null> {
  const dir = join(root, ".openrig", "state", runtime, session, "sessions");
  const [newest] = await newestFirst(dir, (n) => n.endsWith(".jsonl"));
  return newest ? join(dir, newest) : null;
}

/** agy remembers the last conversation per folder in `cache/last_conversations.json`. */
async function findAntigravity(root: string, cwd: string): Promise<string | null> {
  const base = join(root, ".gemini", "antigravity-cli");
  const text = await readFile(join(base, "cache", "last_conversations.json"), "utf8").catch(() => "");
  let map: Record<string, unknown> = {};
  try {
    map = JSON.parse(text);
  } catch {
    return null;
  }
  const id = Object.entries(map).find(([dir]) => sameDir(dir, cwd))?.[1];
  if (typeof id !== "string" || !/^[\w-]+$/.test(id)) return null;
  const logs = join(base, "brain", id, ".system_generated", "logs");
  // transcript_full.jsonl has the tool arguments as plain JSON; transcript.jsonl quotes them twice.
  for (const name of ["transcript_full.jsonl", "transcript.jsonl"]) {
    const file = join(logs, name);
    if (await stat(file).catch(() => null)) return file;
  }
  return null;
}

/** The newest OpenCode session for the seat's folder. */
async function findOpenCode(root: string, cwd: string): Promise<string | null> {
  const database = join(root, ".local", "share", "opencode", "opencode.db");
  if (!(await stat(database).catch(() => null))) return null;
  const id = await new OpenCodeSource(opencodeFile(database, "")).newestSession(cwd, sameDir);
  return id ? opencodeFile(database, id) : null;
}

/**
 * Finds the session file for a seat. Claude Code, and Codex once it has counted tokens, are named by
 * the daemon (`transcriptPath`, a Linux path). For the rest the seat's folder is the key: the newest
 * session of that harness that was started in it. On Windows the seats run in WSL, so the Linux home
 * is searched first and this machine's own home second (OpenCode and agy are often installed there).
 */
export async function locate(seat: Seat, format: ChatFormat, distro: string | null, localPath: (linux: string) => string): Promise<Located | null> {
  if (seat.transcriptPath && format !== "opencode") {
    // A compressed rollout cannot be followed as it grows.
    return seat.transcriptPath.endsWith(".zst") ? null : { format, file: localPath(seat.transcriptPath) };
  }
  const roots = [localPath(await linuxHome(distro))];
  if (distro) roots.push(homedir());
  for (const root of roots) {
    let file: string | null = null;
    if (format === "pi") file = await findPi(root, seat.runtime, seat.session);
    else if (seat.cwd && format === "codex") file = await findCodex(root, seat.cwd);
    else if (seat.cwd && format === "antigravity") file = await findAntigravity(root, seat.cwd);
    else if (seat.cwd && format === "opencode") file = await findOpenCode(root, seat.cwd);
    if (file) return { format, file };
  }
  return null;
}
