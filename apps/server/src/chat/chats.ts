import type { Seat, ServerMessage } from "@rigapp/contracts";
import type { Hub } from "../hub.ts";
import { formatOf, locate, type Located } from "./locate.ts";
import { Thread } from "./thread.ts";

type Listener = (message: ServerMessage) => void;

// Harnesses that do not tell the daemon their session file are searched for; not on every refresh.
const RELOCATE_MS = 5000;

/** Why a seat has no chat, or null when it can have one. */
function unavailable(seat: Seat | undefined): string | null {
  if (!seat) return "RigApp can't find this seat in OpenRig.";
  if (seat.runtime === "terminal") return "This is a terminal seat, so it has no chat. Its live terminal comes in milestone 2.";
  if (!formatOf(seat.runtime)) return `Chat for ${seat.harness} seats is not built yet.`;
  return null;
}

/** Why a seat that can have a chat has no session file yet. */
function missing(seat: Seat): string {
  if (seat.transcriptPath?.endsWith(".zst")) return "This seat's Codex session file is compressed, and RigApp can't follow that.";
  return formatOf(seat.runtime) === "claude"
    ? "OpenRig has not reported this seat's session file yet. It shows up once the seat has started."
    : `RigApp can't find this ${seat.harness} seat's session yet. It shows up once the seat has had its first prompt.`;
}

/** Open threads, one per seat that at least one UI is looking at. */
export class Chats {
  private threads = new Map<string, Thread>();
  private checked = new Map<string, number>();
  private hub: Hub;

  constructor(hub: Hub) {
    this.hub = hub;
    // A seat that restarts gets a new session file: follow the new one.
    hub.listeners.add(() => {
      for (const thread of this.threads.values()) void this.follow(thread);
    });
  }

  private find(seat: Seat): Promise<Located | null> {
    const format = formatOf(seat.runtime);
    return format ? locate(seat, format, this.hub.wslDistro, (path) => this.hub.localPath(path)) : Promise.resolve(null);
  }

  private async follow(thread: Thread): Promise<void> {
    const seat = this.hub.findSeat(thread.session);
    if (!seat) return;
    // The daemon names Claude Code's file, so that one is cheap to compare on every refresh.
    if (!seat.transcriptPath || formatOf(seat.runtime) !== "claude") {
      const last = this.checked.get(thread.session) ?? 0;
      if (Date.now() - last < RELOCATE_MS) return;
      this.checked.set(thread.session, Date.now());
    }
    const found = await this.find(seat);
    if (found && found.file !== thread.file && this.threads.get(thread.session) === thread) await this.reopen(thread);
  }

  async subscribe(session: string, listener: Listener): Promise<void> {
    const seat = this.hub.findSeat(session);
    const why = unavailable(seat);
    const found = seat && !why ? await this.find(seat) : null;
    if (!seat || why || !found) {
      listener({ type: "thread", session, reset: true, items: [], unavailable: why ?? (seat ? missing(seat) : undefined) });
      return;
    }
    let thread = this.threads.get(session);
    if (!thread) {
      thread = new Thread(session, found.file, found.format);
      this.threads.set(session, thread);
    }
    await thread.ready;
    // The UI may have left while the file was being read.
    if (this.threads.get(session) !== thread) return;
    thread.listeners.add(listener);
    listener(thread.snapshot());
  }

  unsubscribe(session: string, listener: Listener): void {
    const thread = this.threads.get(session);
    if (!thread) return;
    thread.listeners.delete(listener);
    if (thread.listeners.size === 0) {
      thread.stop();
      this.threads.delete(session);
      this.checked.delete(session);
    }
  }

  private async reopen(old: Thread): Promise<void> {
    old.stop();
    this.threads.delete(old.session);
    for (const listener of old.listeners) await this.subscribe(old.session, listener);
  }
}
