import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@rigapp/contracts";
import { pressKey, sendText } from "./actions.ts";
import { startBrowser, stopBrowser } from "./browser.ts";
import { gate } from "./browser-gate.ts";
import { view } from "./browser-view.ts";
import { Chats } from "./chat/chats.ts";
import { listFiles, readText } from "./files.ts";
import { Hub } from "./hub.ts";
import { pickFolder } from "./pick.ts";
import { lifecycle } from "./lifecycle.ts";
import { loadSettings, saveSettings, settings } from "./settings.ts";
import { Terminals } from "./terminal.ts";
import { banks, explore, localModels, recall, seatTools } from "./tools.ts";

const PORT = Number(process.env.RIGAPP_PORT ?? 7480);
// The Vite dev server proxies /ws here during `pnpm dev`.
const DEV_PORT = 7481;
// The desktop app ships the built UI next to the server and says where.
const WEB_DIST = process.env.RIGAPP_WEB_DIST ?? fileURLToPath(new URL("../../web/dist/", import.meta.url));
const INDEX = join(WEB_DIST, "index.html");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  const file = join(WEB_DIST, path);
  // Unknown paths fall back to index.html so the UI can handle them.
  const candidates = file.startsWith(WEB_DIST) && file !== WEB_DIST ? [file, INDEX] : [INDEX];
  for (const candidate of candidates) {
    try {
      const body = await readFile(candidate);
      res.writeHead(200, { "content-type": TYPES[extname(candidate)] ?? "application/octet-stream" });
      res.end(body);
      return;
    } catch {
      // not there; try the next one
    }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end(`The web UI is not built. Run pnpm build, or use pnpm dev and open http://localhost:${DEV_PORT}`);
});

// Only RigApp's own pages may connect; any other site open in a browser could
// otherwise reach this loopback socket.
const allowed = new Set([PORT, DEV_PORT].flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]));
const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient: ({ origin }: { origin?: string }) => !origin || allowed.has(origin),
});

await loadSettings();
const hub = new Hub();
const chats = new Chats(hub);
const terminals = new Terminals(
  () => hub.url,
  () => hub.wslDistro,
);

wss.on("connection", (socket) => {
  const send = (message: ServerMessage) => socket.send(JSON.stringify(message));
  const threads = new Set<string>();
  const terms = new Set<string>();
  send(hub.message());
  hub.listeners.add(send);
  send({ type: "browser", state: gate.state() });
  gate.listeners.add(send);
  socket.on("close", () => {
    hub.listeners.delete(send);
    gate.listeners.delete(send);
    view.unwatch(send);
    for (const session of threads) chats.unsubscribe(session, send);
    for (const session of terms) terminals.unsubscribe(session, send);
  });
  socket.on("message", async (data) => {
    const request = JSON.parse(String(data)) as ClientMessage;
    switch (request.method) {
      case "setup.recheck":
        await hub.check();
        break;
      case "thread.subscribe":
        threads.add(request.session);
        await chats.subscribe(request.session, send);
        break;
      case "thread.unsubscribe":
        threads.delete(request.session);
        chats.unsubscribe(request.session, send);
        break;
      case "term.subscribe":
        terms.add(request.session);
        terminals.subscribe(request.session, send);
        break;
      case "term.unsubscribe":
        terms.delete(request.session);
        terminals.unsubscribe(request.session, send);
        break;
      case "term.input":
        send({ type: "result", id: request.id, ...(await terminals.input(request.session, request.data)) });
        return;
      case "browser.watch":
        view.watch(send);
        break;
      case "browser.unwatch":
        view.unwatch(send);
        break;
      case "browser.answer":
        gate.answer(request.ask, request.answer);
        break;
      case "browser.control":
        gate.setControl(request.on);
        break;
      case "browser.input":
        // Fired on every mouse move: no answer is sent back.
        await view.input(request.event).catch(() => {});
        return;
      case "browser.go":
        send({ type: "result", id: request.id, ...(await view.go(request.url)) });
        return;
      case "specs.load":
      case "specs.validate":
      case "specs.save":
      case "rig.up":
      case "rig.down":
      case "rig.snapshots":
      case "rig.snapshot":
      case "rig.restore":
      case "library":
      case "up.spec":
      case "usage":
      case "search":
      case "adopt.scan":
      case "adopt":
      case "bundle.create":
      case "bundle.inspect":
      case "bundle.install":
        send({ type: "result", id: request.id, ...(await lifecycle(hub, request)) });
        return;
      case "settings.set": {
        const moved = request.patch.daemonUrl !== undefined && request.patch.daemonUrl !== settings().daemonUrl;
        const browserWas = settings().tools.browser;
        await saveSettings(request.patch);
        if (settings().tools.browser && !browserWas) {
          const started = await startBrowser(hub.wslDistro);
          if (!started.ok) await saveSettings({ tools: { ...settings().tools, browser: false } });
          if (started.error) {
            hub.settingsChanged(moved);
            send({ type: "result", id: request.id, ok: started.ok, error: started.error });
            return;
          }
        } else if (!settings().tools.browser && browserWas) stopBrowser();
        hub.settingsChanged(moved);
        break;
      }
      case "pick.folder": {
        const picked = await pickFolder();
        send({ type: "result", id: request.id, ok: picked.ok, error: picked.error, data: { path: picked.path ?? null } });
        return;
      }
      case "tools.banks":
        send({ type: "result", id: request.id, ...(await banks()) });
        return;
      case "tools.localModels":
        send({ type: "result", id: request.id, ...(await localModels()) });
        return;
      case "tools.seatTools":
        send({ type: "result", id: request.id, ...(await seatTools(hub.wslDistro)) });
        return;
      case "tools.recall":
        send({ type: "result", id: request.id, ...(await recall(request.bank, request.query)) });
        return;
      case "tools.explore": {
        const seat = hub.findSeat(request.session);
        const answer = seat ? await explore(seat, hub.wslDistro, request.query) : { ok: false, error: "RigApp can't find this seat." };
        send({ type: "result", id: request.id, ...answer });
        return;
      }
      case "files.list":
      case "files.read": {
        const seat = hub.findSeat(request.session);
        if (!seat?.cwd) {
          send({ type: "result", id: request.id, ok: false, error: "OpenRig reports no folder for this seat." });
          return;
        }
        const root = hub.localPath(seat.cwd);
        try {
          send(
            request.method === "files.list"
              ? { type: "result", id: request.id, ok: true, files: await listFiles(root, request.path) }
              : { type: "result", id: request.id, ok: true, text: await readText(root, request.path) },
          );
        } catch (error) {
          send({ type: "result", id: request.id, ok: false, error: (error as Error).message });
        }
        return;
      }
      case "seat.send":
      case "seat.key": {
        const found = hub.find(request.session);
        if (!found) {
          send({ type: "result", id: request.id, ok: false, error: "RigApp can't find this seat in OpenRig." });
          return;
        }
        const result =
          request.method === "seat.send"
            ? await sendText(hub.url, found.seat, found.project.human, request.text, !!request.force)
            : await pressKey(hub.wslDistro, found.seat, request.key);
        hub.nudge();
        send({ type: "result", id: request.id, ...result });
        return;
      }
      default:
        send({ type: "result", id: (request as ClientMessage).id, ok: false, error: "unknown method" });
        return;
    }
    send({ type: "result", id: request.id, ok: true });
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`RigApp on http://127.0.0.1:${PORT}`));
await hub.check();
if (settings().tools.browser) await startBrowser(hub.wslDistro);
process.on("exit", stopBrowser);
// The desktop app holds this process's stdin open; when it closes, the app is quitting or gone, so stop the browser and leave.
if (process.env.RIGAPP_EXIT_WITH_PARENT) process.stdin.on("close", () => process.exit(0)).resume();
