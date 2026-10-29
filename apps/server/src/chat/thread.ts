import type { ChatItem, ServerMessage } from "@rigapp/contracts";
import { openSource, type ChatFormat, type Source } from "./source.ts";

// The UI gets at most this many items when it opens a thread.
const SNAPSHOT_LIMIT = 400;
// fs.watch does not fire reliably across \\wsl.localhost, so poll the file size.
const POLL_MS = 1000;

/** Follows one seat's session (a file, or an OpenCode database) and keeps its chat items. Read-only. */
export class Thread {
  readonly listeners = new Set<(message: ServerMessage) => void>();
  readonly ready: Promise<void>;
  private items: ChatItem[] = [];
  private index = new Map<string, number>();
  private source: Source;
  private reading = false;
  private timer: NodeJS.Timeout | undefined;

  readonly session: string;
  readonly file: string;

  constructor(session: string, file: string, format: ChatFormat = "claude") {
    this.session = session;
    this.file = file;
    this.source = openSource(format, file);
    this.ready = this.read().then(() => {
      this.timer = setInterval(() => void this.read(), POLL_MS);
    });
  }

  stop(): void {
    clearInterval(this.timer);
  }

  snapshot(): ServerMessage {
    return { type: "thread", session: this.session, reset: true, items: this.items.slice(-SNAPSHOT_LIMIT) };
  }

  private async read(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      const { reset, items } = await this.source.read();
      if (reset) {
        this.items = [];
        this.index.clear();
      }
      for (const item of items) {
        const at = this.index.get(item.id);
        if (at === undefined) {
          this.index.set(item.id, this.items.length);
          this.items.push(item);
        } else this.items[at] = item;
      }
      if (reset || items.length) {
        const message: ServerMessage = reset ? this.snapshot() : { type: "thread", session: this.session, reset: false, items };
        for (const listener of this.listeners) listener(message);
      }
    } catch {
      // The file is missing or unreadable for now; try again on the next poll.
    } finally {
      this.reading = false;
    }
  }
}
