import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, connect, type Server as NetServer } from "node:net";
import type { Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gate } from "./browser-gate.ts";
import { startProxy } from "./browser-proxy.ts";
import { view } from "./browser-view.ts";
import { inLinux, platform } from "./setup.ts";

// A browser for seats. One Chromium (Edge or Chrome already on this PC, so nothing big ships)
// runs without a window; Playwright's MCP server drives it over its debugging port, and the
// Browser tab watches the same page (browser-view.ts). Seats reach it from Bash through mcptoon
// (`mcptoon call browser …`), so its 25 tools sit in no seat's context. Every tool call passes
// the gate (browser-gate.ts) through a small proxy (browser-proxy.ts) before it reaches Playwright.
const PORT = 8931;

/** The browser's own process. Edge starts a launcher that hands over to it and exits, so this is not what we spawned. */
let browserPid: number | null = null;
let mcp: ChildProcess | null = null;
let proxy: Server | null = null;
let profile: string | null = null;
let address: string | null = null;
let starting = false;

/** Where seats can reach a server on this machine: the WSL gateway on Windows, localhost on Linux. */
async function hostForSeats(distro: string | null): Promise<string | null> {
  if (platform !== "windows") return "127.0.0.1";
  const route = await inLinux(distro, ["sh", "-c", "ip route | awk '/default/{print $3}'"]);
  const ip = route.out.trim().split("\n").pop()?.trim() ?? "";
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
}

/** The installed app passes the folder it carries Playwright MCP in; from source it is found in node_modules. */
function cliPath(): string | null {
  if (process.env.RIGAPP_MCP_CLI) return process.env.RIGAPP_MCP_CLI;
  try {
    // The package exports only its package.json and index, so find cli.js beside package.json.
    return join(dirname(createRequire(import.meta.url).resolve("@playwright/mcp/package.json")), "cli.js");
  } catch {
    return null;
  }
}

/** Edge or Chrome if present (Windows always has Edge), else a Chromium Playwright downloaded earlier. */
function browserPath(): string | null {
  if (process.env.RIGAPP_BROWSER) return process.env.RIGAPP_BROWSER;
  const fixed =
    platform === "windows"
      ? ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  const found = fixed.find(existsSync);
  if (found) return found;
  const cache = platform === "windows" ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright") : join(homedir(), ".cache", "ms-playwright");
  try {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
      for (const exe of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome"]) {
        if (existsSync(join(cache, dir, exe))) return join(cache, dir, exe);
      }
    }
  } catch {
    // no Playwright cache
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe: NetServer = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

/** Waits until something accepts connections on loopback `port`. */
async function waitForPort(port: number): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (open) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** Chromium writes its debugging port and socket path here once it is ready (we ask for port 0). */
async function debugSocket(dir: string): Promise<string | null> {
  for (let i = 0; i < 100; i++) {
    try {
      const [port, path] = (await readFile(join(dir, "DevToolsActivePort"), "utf8")).split("\n");
      if (port && path) return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

/** Ends a process and what it started: on Windows kill() leaves a browser's helper processes running. */
function end(pid: number | undefined | null): void {
  if (!pid) return;
  if (platform === "windows") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  // Chromium ends its helper processes when its main one goes.
  else process.kill(pid);
}

export function browserState(): { running: boolean; url: string | null } {
  return { running: !!address, url: address };
}

export async function startBrowser(distro: string | null): Promise<{ ok: boolean; error?: string }> {
  if (address || starting) return { ok: true };
  starting = true;
  try {
    const cli = cliPath();
    if (!cli) return { ok: false, error: "RigApp could not find Playwright MCP, which the browser for seats needs." };
    const exe = browserPath();
    if (!exe) return { ok: false, error: "The browser for seats needs Microsoft Edge or Google Chrome, and neither was found." };
    const host = await hostForSeats(distro);
    if (!host) return { ok: false, error: "RigApp could not find the address WSL uses to reach Windows." };

    // Quitting the desktop app ends this process without cleanup, so clear profiles earlier runs left behind.
    for (const old of readdirSync(tmpdir()).filter((name) => name.startsWith("rigapp-browser-"))) {
      try {
        // On Windows a running browser holds its lockfile, so this throws and the folder is left alone.
        rmSync(join(tmpdir(), old, "lockfile"), { force: true });
        rmSync(join(tmpdir(), old), { recursive: true, force: true });
      } catch {
        // in use by a running browser
      }
    }
    profile = await mkdtemp(join(tmpdir(), "rigapp-browser-"));
    spawn(
      exe,
      ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,800", "about:blank"],
      { windowsHide: true, stdio: "ignore" },
    );
    const socket = await debugSocket(profile);
    if (!socket) throw new Error("The browser did not start.");
    // The debugging socket closing is how we learn the browser quit by itself.
    await view.connect(socket, stopBrowser);
    browserPid = await view.browserPid();

    const inner = await freePort();
    const cdp = `http://127.0.0.1:${new URL(socket).port}`;
    mcp = spawn(
      process.execPath,
      [cli, "--cdp-endpoint", cdp, "--host", "127.0.0.1", "--port", String(inner), "--allowed-hosts", `127.0.0.1:${inner}`],
      {
        windowsHide: true,
        stdio: "ignore",
        // Playwright MCP writes its page snapshots under its working folder; keep them out of the install folder.
        cwd: profile,
        // The installed app carries Playwright MCP outside any node_modules, so say where its sibling package is.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_PATH: join(dirname(cli), "..", "..") },
      },
    );
    mcp.on("exit", () => {
      mcp = null;
      stopBrowser();
    });
    if (!(await waitForPort(inner))) throw new Error("Playwright MCP did not start.");
    proxy = await startProxy({ host, port: PORT }, inner);

    address = `http://${host}:${PORT}/mcp`;
    gate.setRunning(true);
    // Point mcptoon's `browser` entry at this address; the WSL gateway can change after a restart.
    const update = `import json,os; p=os.path.expanduser("~/.mcptoon/config.json"); c=json.load(open(p)); c.setdefault("servers",{})["browser"]={"transport":"http","url":"${address}"}; json.dump(c,open(p,"w"),indent=2)`;
    const wrote = await inLinux(distro, ["python3", "-c", update]);
    return wrote.ok ? { ok: true } : { ok: true, error: "The browser started, but mcptoon's config could not be updated (is mcptoon set up in WSL?)." };
  } catch (error) {
    stopBrowser();
    return { ok: false, error: (error as Error).message };
  } finally {
    starting = false;
  }
}

export function stopBrowser(): void {
  view.close();
  proxy?.close();
  proxy?.closeAllConnections();
  proxy = null;
  // Take the listener off first: ending the process would otherwise call back into this function.
  mcp?.removeAllListeners("exit");
  end(mcp?.pid);
  end(browserPid);
  mcp = null;
  browserPid = null;
  address = null;
  // Sync, so it also runs when the server is exiting. On Windows a just-ended browser can still hold a
  // file for a moment; the leftover is a temp folder, so give up quietly rather than crash the server.
  if (profile) {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // left for the system to clean
    }
  }
  profile = null;
  gate.setRunning(false);
}
