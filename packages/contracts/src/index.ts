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
}

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
  | { type: "result"; id: number; ok: boolean; error?: string };

/** UI to server. */
export type ClientMessage = { id: number; method: "setup.recheck" };
