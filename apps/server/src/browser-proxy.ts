import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { gate } from "./browser-gate.ts";

const MAX_BODY = 10 * 1024 * 1024;

interface RpcCall {
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

/** A tool call refused: still a valid MCP answer, so the seat reads the reason instead of seeing a broken connection. */
function refuse(res: ServerResponse, id: unknown, reason: string): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: reason }], isError: true } }));
}

/**
 * Listens where seats can reach it and passes everything on to the Playwright MCP server on
 * loopback, except `tools/call`, which the gate must allow first. `host` is the address seats
 * use; any other Host header is refused (the same guard Playwright MCP's --allowed-hosts gave).
 */
export function startProxy(listen: { host: string; port: number }, inner: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.headers.host !== `${listen.host}:${listen.port}`) {
      res.writeHead(403).end("Host not allowed");
      return;
    }
    let body: Buffer | undefined;
    if (req.method === "POST") {
      const read = await readBody(req);
      if (!read) {
        res.writeHead(413).end("Request too large");
        return;
      }
      body = read;
      let message: RpcCall | RpcCall[] | null = null;
      try {
        message = JSON.parse(body.toString("utf8"));
      } catch {
        // Not JSON: Playwright MCP will refuse it itself.
      }
      // A batch could hide a tool call from the gate; MCP no longer uses batches, so any batch with a call is refused.
      if (Array.isArray(message)) {
        if (message.some((m) => m?.method === "tools/call")) {
          res.writeHead(400).end("Batched tool calls are not allowed");
          return;
        }
      } else if (message?.method === "tools/call") {
        const verdict = await gate.check(String(message.params?.name ?? ""), message.params?.arguments ?? {});
        if (!verdict.ok) return refuse(res, message.id, verdict.reason);
      }
    }
    const upstream = request(
      { host: "127.0.0.1", port: inner, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${inner}` } },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502).end("The browser server is not answering");
      else res.destroy();
    });
    res.on("close", () => upstream.destroy());
    // Only POSTs are read above; other methods (a GET stream, a DELETE) carry no body worth holding back.
    if (body === undefined) req.pipe(upstream);
    else upstream.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen.port, listen.host, () => resolve(server));
  });
}
