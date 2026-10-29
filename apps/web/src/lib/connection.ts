import { useSyncExternalStore } from "react";
import type { ClientMessage, ServerMessage, Shell } from "@rigapp/contracts";

// One WebSocket to the RigApp server. The server sends the whole shell on
// connect and again on every change, so the UI only keeps the latest copy.

interface State {
  connected: boolean;
  shell: Shell | null;
}

let state: State = { connected: false, shell: null };
const listeners = new Set<() => void>();
const pending = new Map<number, (message: Extract<ServerMessage, { type: "result" }>) => void>();
let socket: WebSocket;
let nextId = 1;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function connect() {
  socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data) as ServerMessage;
    if (message.type === "shell") set({ connected: true, shell: message.shell });
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

export function request(method: ClientMessage["method"]): Promise<void> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (result) => (result.ok ? resolve() : reject(new Error(result.error))));
    socket.send(JSON.stringify({ id, method } satisfies ClientMessage));
  });
}
