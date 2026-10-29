import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { inLinux, platform } from "./setup.ts";

// A headless browser for seats: Playwright's MCP server, reached from seats through
// mcptoon (`mcptoon call browser …`), so its 25 tools sit in no seat's context.
const PORT = 8931;

let child: ChildProcess | null = null;
let address: string | null = null;

/** Where seats can reach a server on this machine: the WSL gateway on Windows, localhost on Linux. */
async function hostForSeats(distro: string | null): Promise<string | null> {
  if (platform !== "windows") return "127.0.0.1";
  const route = await inLinux(distro, ["sh", "-c", "ip route | awk '/default/{print $3}'"]);
  const ip = route.out.trim().split("\n").pop()?.trim() ?? "";
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
}

function cliPath(): string | null {
  try {
    // The package exports only its package.json and index, so find cli.js beside package.json.
    return join(dirname(createRequire(import.meta.url).resolve("@playwright/mcp/package.json")), "cli.js");
  } catch {
    return null;
  }
}

export function browserState(): { running: boolean; url: string | null } {
  return { running: !!child, url: address };
}

export async function startBrowser(distro: string | null): Promise<{ ok: boolean; error?: string }> {
  if (child) return { ok: true };
  const cli = cliPath();
  if (!cli) return { ok: false, error: "The browser for seats needs RigApp run from its source folder for now (the installed app does not carry it yet)." };
  const host = await hostForSeats(distro);
  if (!host) return { ok: false, error: "RigApp could not find the address WSL uses to reach Windows." };
  const url = `http://${host}:${PORT}/mcp`;
  child = spawn(process.execPath, [cli, "--headless", "--isolated", "--browser", "chromium", "--host", host, "--port", String(PORT), "--allowed-hosts", `${host}:${PORT}`], {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.on("exit", () => {
    child = null;
    address = null;
  });
  address = url;
  // Point mcptoon's `browser` entry at this address; the WSL gateway can change after a restart.
  const update = `import json,os; p=os.path.expanduser("~/.mcptoon/config.json"); c=json.load(open(p)); c.setdefault("servers",{})["browser"]={"transport":"http","url":"${url}"}; json.dump(c,open(p,"w"),indent=2)`;
  const wrote = await inLinux(distro, ["python3", "-c", update]);
  return wrote.ok ? { ok: true } : { ok: true, error: "The browser started, but mcptoon's config could not be updated (is mcptoon set up in WSL?)." };
}

export function stopBrowser(): void {
  child?.kill();
  child = null;
  address = null;
}
