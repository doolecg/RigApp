// Wire types shared by the server and the web UI. Types only, no runtime code,
// so both sides can import them without a build step.

/** The daemon's activity states, as OpenRig reports them in `agentActivity.state`. */
export type Activity = "running" | "needs_input" | "idle" | "unknown";

export interface Seat {
  /** OpenRig session name, the seat's address: `{pod}-{member}@{rig}`. */
  session: string;
  /** `{pod}.{member}` */
  logicalId: string;
  pod: string;
  member: string;
  /** OpenRig runtime id, e.g. `claude-code`, `codex`, `terminal`. */
  runtime: string;
  /** Human label for the runtime, e.g. "Claude Code". */
  harness: string;
  kind: string;
  /** `sessionStatus` from the daemon, e.g. `running`, `exited`. */
  status: string;
  activity: Activity;
  startup: string;
  error: string | null;
  restorePolicy: string | null;
  agentRef: string | null;
  cwd: string | null;
  contextPercent: number | null;
  attachCommand: string | null;
  /** The harness session file as the daemon reports it (a Linux path), if known. */
  transcriptPath: string | null;
  /** When the seat last did something, from the daemon (ISO time). */
  lastActivityAt: string | null;
  /** The bottom of the seat's pane while it waits on you (`needs_input`), else null. */
  prompt: string | null;
}

/** One row of a thread's chat, read from the seat's harness session file. */
export type ChatItem =
  | { kind: "user"; id: string; at: string | null; text: string }
  | { kind: "assistant"; id: string; at: string | null; text: string }
  | {
      kind: "tool";
      id: string;
      at: string | null;
      name: string;
      input: Record<string, unknown>;
      /** Null until the result line arrives. Long results are cut short. */
      result: string | null;
      error: boolean;
    };

export interface Pod {
  name: string;
  seats: Seat[];
}

export interface Project {
  id: string;
  name: string;
  /** `status` from `/api/ps`, e.g. `running`, `stopped`. */
  status: string;
  uptime: string | null;
  latestSnapshot: string | null;
  /** Session name of the seat you talk to. */
  lead: string | null;
  /** The rig's terminal seat: messages from RigApp are signed as this seat, the human. */
  human: string | null;
  pods: Pod[];
}

export interface DaemonInfo {
  url: string;
  ok: boolean;
  version: string | null;
  /** "WSL Ubuntu" on Windows, "local" on Linux. */
  host: string;
}

export interface SetupCheck {
  id: "wsl" | "tmux" | "rig" | "daemon";
  label: string;
  ok: boolean;
  detail: string;
}

export interface Shell {
  daemon: DaemonInfo;
  /** Filled while the daemon is unreachable, empty once it answers. */
  checks: SetupCheck[];
  platform: "windows" | "linux";
  projects: Project[];
}

/** Server to UI. The shell is sent whole on connect and on every change. */
export type ServerMessage =
  | { type: "shell"; seq: number; shell: Shell }
  | {
      type: "thread";
      session: string;
      /** True: `items` is the whole chat. False: add these, or replace ones with the same id. */
      reset: boolean;
      items: ChatItem[];
      /** Why there is no chat for this seat, when there is none. */
      unavailable?: string;
    }
  /** `reason` is the daemon's refusal code when it refused a send. */
  | { type: "result"; id: number; ok: boolean; error?: string; reason?: string };

/** UI to server. */
export type ClientMessage =
  | { id: number; method: "setup.recheck" }
  | { id: number; method: "thread.subscribe" | "thread.unsubscribe"; session: string }
  /** `force` sends even when the seat is busy (the daemon's `mid_work` refusal). */
  | { id: number; method: "seat.send"; session: string; text: string; force?: boolean }
  | { id: number; method: "seat.key"; session: string; key: "approve" | "deny" | "stop" };
