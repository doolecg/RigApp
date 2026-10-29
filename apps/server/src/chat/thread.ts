import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import type { ChatItem, ServerMessage } from "@rigapp/contracts";
import { ClaudeParser } from "./claude.ts";

// The UI gets at most this many items when it opens a thread.
const SNAPSHOT_LIMIT = 400;
// fs.watch does not fire reliably across \\wsl.localhost, so poll the file size.
const POLL_MS = 1000;

/** Follows one seat's session file and keeps its chat items. Read-only. */
export class Thread {
  readonly listeners = new Set<(message: ServerMessage) => void>();
  readonly ready: Promise<void>;
  private items: ChatItem[] = [];
  private index = new Map<string, number>();
  private parser = new ClaudeParser();
  private decoder = new StringDecoder("utf8");
  private offset = 0;
  private rest = "";
  private reading = false;
  private timer: NodeJS.Timeout | undefined;

  readonly session: string;
  readonly file: string;

  constructor(session: string, file: string) {
    this.session = session;
    this.file = file;
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
      const { size } = await stat(this.file);
      if (size < this.offset) this.restart();
      if (size === this.offset) return;
      const handle = await open(this.file, "r");
      const buffer = Buffer.alloc(size - this.offset);
      try {
        await handle.read(buffer, 0, buffer.length, this.offset);
      } finally {
        await handle.close();
      }
      this.offset = size;
      // Keep any half-written last line for the next read.
      const lines = (this.rest + this.decoder.write(buffer)).split("\n");
      this.rest = lines.pop() ?? "";
      const changed = this.parser.parse(lines);
      for (const item of changed) {
        const at = this.index.get(item.id);
        if (at === undefined) {
          this.index.set(item.id, this.items.length);
          this.items.push(item);
        } else this.items[at] = item;
      }
      if (changed.length) {
        const message: ServerMessage = { type: "thread", session: this.session, reset: false, items: changed };
        for (const listener of this.listeners) listener(message);
      }
    } catch {
      // The file is missing or unreadable for now; try again on the next poll.
    } finally {
      this.reading = false;
    }
  }

  /** The file got shorter, so it was replaced: read it again from the top. */
  private restart(): void {
    this.items = [];
    this.index.clear();
    this.parser = new ClaudeParser();
    this.decoder = new StringDecoder("utf8");
    this.offset = 0;
    this.rest = "";
    for (const listener of this.listeners) listener({ type: "thread", session: this.session, reset: true, items: [] });
  }
}
