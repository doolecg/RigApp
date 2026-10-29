import { WebSocket } from "ws";
import type { BrowserInput, ServerMessage } from "@rigapp/contracts";
import { gate } from "./browser-gate.ts";

// The human's window onto the browser seats drive. It is a second client of the same Chromium
// (its remote-debugging port), so what you see is exactly the page the seat works on. While a
// Browser tab is open the page is streamed as screencast pictures; with none open, nothing is sent.

type Listener = (message: ServerMessage) => void;
type Frame = Extract<ServerMessage, { type: "browser.frame" }>;

interface PageInfo {
  url: string;
  title: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, any>;
  result?: Record<string, any>;
  error?: { message: string };
  sessionId?: string;
}

class View {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private calls = new Map<number, { resolve: (value: Record<string, any>) => void; reject: (error: Error) => void }>();
  /** Open pages in the order they appeared; the newest is the one shown. */
  private pages = new Map<string, PageInfo>();
  private current: string | null = null;
  private shown: { target: string; session: string } | null = null;
  private watchers = new Set<Listener>();
  private lastFrame: Frame | null = null;

  async connect(url: string, onLost: () => void): Promise<void> {
    const ws = new WebSocket(url);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.on("message", (data) => this.onMessage(JSON.parse(String(data)) as CdpMessage));
    ws.on("close", () => {
      // Only a socket we did not close ourselves means the browser went away.
      if (this.ws !== ws) return;
      this.reset();
      onLost();
    });
    await this.send("Target.setDiscoverTargets", { discover: true });
  }

  /** The browser process's id, to end it and its helpers from outside if asking nicely fails. */
  async browserPid(): Promise<number | null> {
    const { processInfo } = await this.send("SystemInfo.getProcessInfo");
    return (processInfo as { type: string; id: number }[]).find((p) => p.type === "browser")?.id ?? null;
  }

  /** Asks the browser to quit, which ends all its helper processes; killing only its first process can leave them running. */
  close(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ id: this.nextId++, method: "Browser.close" }));
    this.ws?.close();
    this.reset();
  }

  private reset(): void {
    this.ws = null;
    for (const call of this.calls.values()) call.reject(new Error("The browser closed."));
    this.calls.clear();
    this.pages.clear();
    this.current = null;
    this.shown = null;
    this.lastFrame = null;
  }

  private send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, any>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("The browser is not running."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private onMessage(message: CdpMessage): void {
    if (message.id !== undefined) {
      const call = this.calls.get(message.id);
      this.calls.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message));
      else call?.resolve(message.result ?? {});
      return;
    }
    const params = message.params ?? {};
    switch (message.method) {
      case "Target.targetCreated":
      case "Target.targetInfoChanged": {
        const info = params.targetInfo as { targetId: string; type: string; url: string; title: string };
        if (info.type !== "page") return;
        const isNew = !this.pages.has(info.targetId);
        this.pages.set(info.targetId, { url: info.url, title: info.title });
        if (isNew) {
          this.current = info.targetId;
          void this.retarget();
        }
        if (this.current === info.targetId) this.publishPage();
        return;
      }
      case "Target.targetDestroyed": {
        const target = params.targetId as string;
        this.pages.delete(target);
        if (this.current === target) {
          this.current = [...this.pages.keys()].pop() ?? null;
          void this.retarget();
          this.publishPage();
        }
        return;
      }
      case "Target.detachedFromTarget":
        if (this.shown?.session === params.sessionId) this.shown = null;
        return;
      case "Page.screencastFrame": {
        if (message.sessionId !== this.shown?.session) return;
        // The browser sends no more frames until each one is acknowledged.
        void this.send("Page.screencastFrameAck", { sessionId: params.sessionId }, message.sessionId).catch(() => {});
        const meta = params.metadata as { deviceWidth: number; deviceHeight: number };
        this.lastFrame = { type: "browser.frame", data: params.data as string, width: meta.deviceWidth, height: meta.deviceHeight };
        for (const watcher of this.watchers) watcher(this.lastFrame);
        return;
      }
    }
  }

  private publishPage(): void {
    gate.page = this.current ? (this.pages.get(this.current) ?? null) : null;
    gate.publish();
  }

  /** Streams the current page when someone is watching and stops when no one is. */
  private async retarget(): Promise<void> {
    const wanted = this.watchers.size > 0 ? this.current : null;
    if (this.shown && this.shown.target === wanted) return;
    const old = this.shown;
    this.shown = null;
    this.lastFrame = null;
    if (old) {
      await this.send("Page.stopScreencast", {}, old.session).catch(() => {});
      await this.send("Target.detachFromTarget", { sessionId: old.session }).catch(() => {});
    }
    if (!wanted) return;
    try {
      const { sessionId } = await this.send("Target.attachToTarget", { targetId: wanted, flatten: true });
      this.shown = { target: wanted, session: sessionId };
      await this.send("Page.enable", {}, sessionId);
      await this.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 1600, maxHeight: 1200 }, sessionId);
    } catch {
      this.shown = null;
    }
  }

  watch(listener: Listener): void {
    this.watchers.add(listener);
    if (this.lastFrame) listener(this.lastFrame);
    void this.retarget();
  }

  unwatch(listener: Listener): void {
    this.watchers.delete(listener);
    if (this.watchers.size === 0) void this.retarget();
  }

  /** Mouse, wheel and key events from you, sent to the page. Dropped unless you hold the browser. */
  async input(event: BrowserInput): Promise<void> {
    const session = this.shown?.session;
    if (!session || !gate.control) return;
    switch (event.kind) {
      case "mouse":
        await this.send(
          "Input.dispatchMouseEvent",
          {
            type: { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" }[event.type],
            x: event.x,
            y: event.y,
            button: event.type === "move" ? "none" : event.button,
            clickCount: event.clicks,
          },
          session,
        );
        return;
      case "wheel":
        await this.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: event.x, y: event.y, deltaX: event.dx, deltaY: event.dy }, session);
        return;
      case "key":
        await this.send(
          "Input.dispatchKeyEvent",
          {
            type: event.type === "up" ? "keyUp" : event.text ? "keyDown" : "rawKeyDown",
            key: event.key,
            code: event.code,
            windowsVirtualKeyCode: event.keyCode,
            modifiers: event.modifiers,
            ...(event.text && event.type === "down" ? { text: event.text, unmodifiedText: event.text } : {}),
          },
          session,
        );
        return;
      case "text":
        await this.send("Input.insertText", { text: event.text }, session);
        return;
    }
  }

  /** The address bar: only while you hold the browser, and only web pages. */
  async go(address: string): Promise<{ ok: boolean; error?: string }> {
    const session = this.shown?.session;
    if (!session || !gate.control) return { ok: false, error: "Take control of the browser first." };
    const url = /^[a-z][a-z0-9+.-]*:/i.test(address) ? address : `https://${address}`;
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Only http and https addresses can be opened here." };
    try {
      await this.send("Page.navigate", { url }, session);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}

export const view = new View();
