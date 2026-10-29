import { execFile } from "node:child_process";
import { WebSocket } from "ws";
import type { ServerMessage } from "@rigapp/contracts";

type Listener = (message: ServerMessage) => void;

/** What one chunk of xterm input becomes: tmux key names, or literal text. */
export type Input = { type: "keys"; keys: string[] } | { type: "text"; text: string };

// The same mapping OpenRig's own web terminal uses (packages/ui FocusedTerminal.tsx).
const ESCAPES: Record<string, string> = {
  "\x1b[A": "Up",
  "\x1b[B": "Down",
  "\x1b[C": "Right",
  "\x1b[D": "Left",
  "\x1b[H": "Home",
  "\x1b[F": "End",
  "\x1b[5~": "PgUp",
  "\x1b[6~": "PgDn",
  "\x1b[3~": "DC",
  "\x1b[2~": "IC",
};
const SPECIAL: Record<string, string> = {
  "\r": "Enter",
  "\x7f": "BSpace",
  "\x1b": "Escape",
  "\t": "Tab",
  "\x03": "C-c",
  "\x04": "C-d",
  "\x01": "C-a",
  "\x05": "C-e",
  "\x0b": "C-k",
  "\x15": "C-u",
  "\x17": "C-w",
  "\x0c": "C-l",
  "\x1a": "C-z",
};

export function mapInput(data: string): Input[] {
  const out: Input[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  for (let i = 0; i < data.length; i++) {
    const escape = data[i] === "\x1b" ? Object.keys(ESCAPES).find((seq) => data.startsWith(seq, i)) : undefined;
    if (escape) {
      flush();
      out.push({ type: "keys", keys: [ESCAPES[escape]!] });
      i += escape.length - 1;
    } else if (SPECIAL[data[i]!]) {
      flush();
      out.push({ type: "keys", keys: [SPECIAL[data[i]!]!] });
    } else text += data[i];
  }
  flush();
  return out;
}

// Without the daemon's terminal socket, re-read the pane at OpenRig's own preview rate.
const PREVIEW_MS = 3000;

interface Viewer {
  listeners: Set<Listener>;
  socket: WebSocket | null;
  timer: NodeJS.Timeout | undefined;
  last: string;
}

/**
 * A seat's live terminal. Uses the daemon's `ws://…/api/terminal/:session` when
 * `ui.enabled` is on (systems.md gap 4); otherwise polls `POST /api/transport/capture`
 * every 3 s. Typing goes to the socket, or to `tmux send-keys` without it.
 */
export class Terminals {
  private viewers = new Map<string, Viewer>();
  private url: () => string;
  private distro: () => string | null;

  constructor(url: () => string, distro: () => string | null) {
    this.url = url;
    this.distro = distro;
  }

  subscribe(session: string, listener: Listener): void {
    let viewer = this.viewers.get(session);
    if (!viewer) {
      viewer = { listeners: new Set(), socket: null, timer: undefined, last: "" };
      this.viewers.set(session, viewer);
      viewer.listeners.add(listener);
      this.connect(session, viewer);
      return;
    }
    viewer.listeners.add(listener);
    // A late viewer of a polled pane gets the last screen straight away.
    if (!viewer.socket && viewer.last) listener({ type: "term", session, mode: "preview", screen: viewer.last });
  }

  unsubscribe(session: string, listener: Listener): void {
    const viewer = this.viewers.get(session);
    if (!viewer) return;
    viewer.listeners.delete(listener);
    if (viewer.listeners.size) return;
    clearInterval(viewer.timer);
    viewer.socket?.close();
    this.viewers.delete(session);
  }

  async input(session: string, data: string): Promise<{ ok: boolean; error?: string }> {
    const parts = mapInput(data);
    const socket = this.viewers.get(session)?.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      for (const part of parts) socket.send(JSON.stringify(part));
      return { ok: true };
    }
    for (const part of parts) {
      const args = part.type === "keys" ? part.keys : ["-l", part.text];
      const result = await this.tmux(["send-keys", "-t", session, ...args]);
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  private emit(session: string, message: ServerMessage) {
    for (const listener of this.viewers.get(session)?.listeners ?? []) listener(message);
  }

  private connect(session: string, viewer: Viewer) {
    const socket = new WebSocket(`${this.url().replace(/^http/, "ws")}/api/terminal/${encodeURIComponent(session)}`);
    let opened = false;
    socket.on("open", () => {
      opened = true;
      viewer.socket = socket;
      this.emit(session, { type: "term", session, mode: "live", data: "" });
    });
    socket.on("message", (data) => this.emit(session, { type: "term", session, mode: "live", data: String(data) }));
    socket.on("error", () => {});
    socket.on("close", () => {
      viewer.socket = null;
      if (!this.viewers.has(session)) return;
      // Never opened: the socket is off (404), so poll the pane instead.
      if (!opened) this.poll(session, viewer);
      else this.emit(session, { type: "term", session, mode: "ended", data: "" });
    });
  }

  private poll(session: string, viewer: Viewer) {
    const read = async () => {
      try {
        const res = await fetch(`${this.url()}/api/transport/capture`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session, lines: 60 }),
          signal: AbortSignal.timeout(5000),
        });
        const body = (await res.json()) as { ok?: boolean; content?: string };
        const screen = body.ok ? (body.content ?? "") : "";
        if (screen === viewer.last) return;
        viewer.last = screen;
        this.emit(session, { type: "term", session, mode: "preview", screen });
      } catch {
        // The daemon is busy or restarting; the next poll tries again.
      }
    };
    void read();
    viewer.timer = setInterval(() => void read(), PREVIEW_MS);
  }

  private tmux(args: string[]): Promise<{ ok: boolean; error?: string }> {
    const distro = this.distro();
    const [cmd, argv] = distro ? ["wsl.exe", ["-d", distro, "-e", "tmux", ...args]] : ["tmux", args];
    return new Promise((resolve) => {
      execFile(cmd, argv, { windowsHide: true, timeout: 10000 }, (err, _out, stderr) => {
        resolve(err ? { ok: false, error: String(stderr).trim() || err.message } : { ok: true });
      });
    });
  }
}
