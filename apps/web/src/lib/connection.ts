import { useSyncExternalStore } from "react";
import type { ChatItem, ClientMessage, ServerMessage, Shell } from "@rigapp/contracts";

// One WebSocket to the RigApp server. The server sends the whole shell on
// connect and again on every change, so the UI only keeps the latest copy.
// Threads are sent whole when opened, then as added or changed items.

export interface ThreadState {
  items: ChatItem[];
  unavailable?: string;
}

interface State {
  connected: boolean;
  shell: Shell | null;
  threads: Record<string, ThreadState>;
}

let state: State = { connected: false, shell: null, threads: {} };
const listeners = new Set<() => void>();
const pending = new Map<number, (message: Extract<ServerMessage, { type: "result" }>) => void>();
/** Threads some view is showing, with how many views show each. */
const watched = new Map<string, number>();
type TermMessage = Extract<ServerMessage, { type: "term" }>;
/** Terminal views, by seat. Terminal output is streamed to them, not kept in state. */
const terminals = new Map<string, Set<(message: TermMessage) => void>>();
// Omit each member of the union separately, so `session` stays allowed.
type Outgoing<T = ClientMessage> = T extends unknown ? Omit<T, "id"> : never;

let socket: WebSocket;
let nextId = 1;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function send(message: Outgoing): number {
  const id = nextId++;
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...message, id }));
  return id;
}

function applyThread(message: Extract<ServerMessage, { type: "thread" }>) {
  if (!watched.has(message.session)) return;
  let items = message.items;
  if (!message.reset) {
    items = [...(state.threads[message.session]?.items ?? [])];
    const index = new Map(items.map((item, i) => [item.id, i]));
    for (const item of message.items) {
      const at = index.get(item.id);
      if (at === undefined) items.push(item);
      else items[at] = item;
    }
  }
  set({ threads: { ...state.threads, [message.session]: { items, unavailable: message.unavailable } } });
}

function connect() {
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.onopen = () => {
    for (const session of watched.keys()) send({ method: "thread.subscribe", session });
    for (const session of terminals.keys()) send({ method: "term.subscribe", session });
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data) as ServerMessage;
    if (message.type === "shell") set({ connected: true, shell: message.shell });
    else if (message.type === "thread") applyThread(message);
    else if (message.type === "term") for (const listener of terminals.get(message.session) ?? []) listener(message);
    else {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  };
  socket.onclose = () => {
    set({ connected: false });
    setTimeout(connect, 1000);
  };
}

connect();

export function useConnection(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export type Result = Extract<ServerMessage, { type: "result" }>;

/** Asks the server to do something; resolves with its answer, never rejects. */
export function request(message: Outgoing): Promise<Result> {
  if (socket.readyState !== WebSocket.OPEN) {
    return Promise.resolve({ type: "result", id: 0, ok: false, error: "Not connected to the RigApp server." });
  }
  return new Promise((resolve) => pending.set(send(message), resolve));
}

/** Follows a seat's terminal; call the returned function to stop. */
export function onTerm(session: string, listener: (message: TermMessage) => void): () => void {
  let set = terminals.get(session);
  if (!set) {
    set = new Set();
    terminals.set(session, set);
    send({ method: "term.subscribe", session });
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size) return;
    terminals.delete(session);
    send({ method: "term.unsubscribe", session });
  };
}

/** Starts following a seat's chat; call the returned function to stop. */
export function watchThread(session: string): () => void {
  const count = watched.get(session) ?? 0;
  watched.set(session, count + 1);
  if (count === 0) send({ method: "thread.subscribe", session });
  return () => {
    const left = (watched.get(session) ?? 1) - 1;
    if (left > 0) return void watched.set(session, left);
    watched.delete(session);
    send({ method: "thread.unsubscribe", session });
    const { [session]: _, ...rest } = state.threads;
    set({ threads: rest });
  };
}
