import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface RunningServer {
  url: string;
  child: ChildProcess;
}

/** First free port on loopback from `from` up; the server needs a fixed port its page's Origin matches. */
export async function freePort(from: number): Promise<number> {
  for (let port = from; port < from + 50; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No free port between ${from} and ${from + 49}.`);
}

interface Options {
  /** The bundled server.mjs. */
  script: string;
  webDist: string;
  dataDir: string;
  version: string;
  /** Playwright MCP's cli.js, staged by scripts/stage-mcp.mjs: the bundled server cannot find it in node_modules. */
  mcpCli: string;
  /** Called if the server stops by itself (a crash), not when we stop it. */
  onCrash: (reason: string) => void;
}

/** Runs the RigApp server with Electron's own Node and resolves once it says where it listens. */
export async function startServer(options: Options): Promise<RunningServer> {
  // RIGAPP_PORT_FROM lets a test run start its search elsewhere, away from a RigApp already open.
  const port = await freePort(Number(process.env.RIGAPP_PORT_FROM ?? 7480));
  const child = spawn(process.execPath, [options.script], {
    // Makes the Electron binary behave as plain Node, so no separate Node install is needed.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      RIGAPP_PORT: String(port),
      RIGAPP_WEB_DIST: options.webDist,
      RIGAPP_DATA_DIR: options.dataDir,
      RIGAPP_VERSION: options.version,
      RIGAPP_MCP_CLI: options.mcpCli,
      RIGAPP_EXIT_WITH_PARENT: "1",
    },
    // stdin stays open so the server can tell when the app is gone, and so the app can ask it to quit.
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const url = await new Promise<string>((resolve, reject) => {
    let recent = "";
    const onLine = (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(`[server] ${text}`);
      recent = (recent + text).slice(-2000);
      const match = /RigApp on (http:\/\/127\.0\.0\.1:\d+)/.exec(recent);
      if (match?.[1]) resolve(match[1]);
    };
    child.stdout?.on("data", onLine);
    child.stderr?.on("data", onLine);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`The server stopped (exit code ${code}).\n${recent.trim()}`)));
  });

  // From here on an exit is a crash, unless the app killed it on purpose (which sets child.killed).
  child.on("exit", (code) => {
    if (!child.killed) options.onCrash(`The server stopped (exit code ${code}).`);
  });
  return { url, child };
}
