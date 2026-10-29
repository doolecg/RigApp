import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SetupCheck, Shell } from "@rigapp/contracts";
import { health } from "./openrig/client.ts";
import { settings } from "./settings.ts";

export const platform: Shell["platform"] = process.platform === "win32" ? "windows" : "linux";

interface Run {
  ok: boolean;
  out: string;
}

function run(cmd: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    // WSL_UTF8 makes wsl.exe print UTF-8 instead of UTF-16.
    const env = { ...process.env, WSL_UTF8: "1" };
    execFile(cmd, args, { windowsHide: true, timeout: 15000, env }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout).trim() });
    });
  });
}

/** Runs a command on the Linux side: inside WSL on Windows, locally on Linux. */
function inLinux(distro: string | null, args: string[]): Promise<Run> {
  return distro ? run("wsl.exe", ["-d", distro, "-e", ...args]) : run(args[0]!, args.slice(1));
}

/** The WSL distro to use: RIGAPP_WSL_DISTRO, else the default one. */
async function findDistro(): Promise<{ name: string; state: string } | null> {
  const list = await run("wsl.exe", ["-l", "-v"]);
  if (!list.ok) return null;
  const wanted = process.env.RIGAPP_WSL_DISTRO;
  for (const row of list.out.split(/\r?\n/).slice(1)) {
    const isDefault = row.trim().startsWith("*");
    const [name, state] = row.replace(/^\s*\*?\s*/, "").split(/\s+/);
    if (name && (wanted ? name === wanted : isDefault)) return { name, state: state ?? "" };
  }
  return null;
}

/** RIGAPP_DAEMON_URL, else the address in Settings, else the port in ~/.openrig/daemon.json, else 7433. */
async function locateDaemon(distro: string | null): Promise<string> {
  const set = process.env.RIGAPP_DAEMON_URL || settings().daemonUrl;
  if (set) return set.replace(/\/$/, "");
  let text = "";
  if (platform === "linux") text = await readFile(join(homedir(), ".openrig", "daemon.json"), "utf8").catch(() => "");
  else if (distro) text = (await inLinux(distro, ["sh", "-c", "cat ~/.openrig/daemon.json"])).out;
  let port = 7433;
  try {
    port = JSON.parse(text).port ?? port;
  } catch {
    // No state file: the daemon has never run, so use OpenRig's default port.
  }
  return `http://127.0.0.1:${port}`;
}

export interface CheckResult {
  url: string;
  /** "WSL Ubuntu" or "local". */
  host: string;
  distro: string | null;
  version: string | null;
  /** Empty when the daemon answers. */
  checks: SetupCheck[];
}

export async function runChecks(): Promise<CheckResult> {
  const checks: SetupCheck[] = [];
  let distro: string | null = null;
  if (platform === "windows") {
    const found = await findDistro();
    distro = found?.name ?? null;
    checks.push({
      id: "wsl",
      label: "WSL2",
      ok: !!found,
      detail: found ? `Installed · ${found.name} ${found.state.toLowerCase()}` : "WSL2 or a Linux distro is missing",
    });
  }
  const host = distro ? `WSL ${distro}` : "local";
  const url = await locateDaemon(distro);
  const h = await health(url);
  if (h) return { url, host, distro, version: h.semver, checks: [] };

  const where = distro ? ` in ${distro}` : "";
  const canRun = platform === "linux" || !!distro;
  const [tmux, rig] = canRun
    ? await Promise.all([
        inLinux(distro, ["sh", "-c", "command -v tmux"]),
        // -i loads ~/.bashrc, where nvm puts the rig CLI on PATH.
        inLinux(distro, ["bash", "-ic", "rig --version"]),
      ])
    : [null, null];
  checks.push(
    { id: "tmux", label: `tmux${where}`, ok: !!tmux?.ok, detail: tmux?.ok ? tmux.out : `tmux not found${where}` },
    {
      id: "rig",
      label: "OpenRig CLI",
      ok: !!rig?.ok,
      detail: rig?.ok ? `rig ${rig.out.split("\n").pop()}` : `rig not found${where}`,
    },
    { id: "daemon", label: "Daemon", ok: false, detail: `Nothing answering on ${url.replace("http://", "")}` },
  );
  return { url, host, distro, version: null, checks };
}
