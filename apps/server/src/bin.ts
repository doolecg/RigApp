import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@rigapp/contracts";
import { Hub } from "./hub.ts";

const PORT = Number(process.env.RIGAPP_PORT ?? 7480);
// The Vite dev server proxies /ws here during `pnpm dev`.
const DEV_PORT = 7481;
const WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));
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

const hub = new Hub();

wss.on("connection", (socket) => {
  const send = (message: ServerMessage) => socket.send(JSON.stringify(message));
  send(hub.message());
  hub.listeners.add(send);
  socket.on("close", () => hub.listeners.delete(send));
  socket.on("message", async (data) => {
    const request = JSON.parse(String(data)) as ClientMessage;
    if (request.method === "setup.recheck") {
      await hub.check();
      send({ type: "result", id: request.id, ok: true });
    } else {
      send({ type: "result", id: request.id, ok: false, error: `unknown method ${String(request.method)}` });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`RigApp on http://127.0.0.1:${PORT}`));
await hub.check();
