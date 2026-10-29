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
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data) as ServerMessage;
    if (message.type === "shell") set({ connected: true, shell: message.shell });
    else if (message.type === "thread") applyThread(message);
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

export function request(method: "setup.recheck"): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = send({ method });
    pending.set(id, (result) => (result.ok ? resolve() : reject(new Error(result.error))));
  });
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
