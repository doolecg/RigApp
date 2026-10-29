import type { Seat, ServerMessage } from "@rigapp/contracts";
import type { Hub } from "../hub.ts";
import { Thread } from "./thread.ts";

type Listener = (message: ServerMessage) => void;

/** Why a seat has no chat, or null when it can have one. */
function unavailable(seat: Seat | undefined): string | null {
  if (!seat) return "RigApp can't find this seat in OpenRig.";
  if (seat.runtime === "terminal") return "This is a terminal seat, so it has no chat. Its live terminal comes in milestone 2.";
  if (seat.runtime !== "claude-code") return `Chat for ${seat.harness} seats is not built yet.`;
  if (!seat.transcriptPath) return "OpenRig has not reported this seat's session file yet. It shows up once the seat has started.";
  return null;
}

/** Open threads, one per seat that at least one UI is looking at. */
export class Chats {
  private threads = new Map<string, Thread>();
  private hub: Hub;

  constructor(hub: Hub) {
    this.hub = hub;
    // A seat that restarts gets a new session file: follow the new one.
    hub.listeners.add(() => {
      for (const [session, thread] of this.threads) {
        const seat = hub.findSeat(session);
        if (seat?.transcriptPath && hub.localPath(seat.transcriptPath) !== thread.file) void this.reopen(thread);
      }
    });
  }

  async subscribe(session: string, listener: Listener): Promise<void> {
    const seat = this.hub.findSeat(session);
    const why = unavailable(seat);
    if (why || !seat?.transcriptPath) {
      listener({ type: "thread", session, reset: true, items: [], unavailable: why ?? undefined });
      return;
    }
    let thread = this.threads.get(session);
    if (!thread) {
      thread = new Thread(session, this.hub.localPath(seat.transcriptPath));
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
    }
  }

  private async reopen(old: Thread): Promise<void> {
    old.stop();
    this.threads.delete(old.session);
    for (const listener of old.listeners) await this.subscribe(old.session, listener);
  }
}
