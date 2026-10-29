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

/** One row of a folder listing in the Files tab. */
export interface FileEntry {
  name: string;
  dir: boolean;
  size: number;
}

/** A rig's spec or culture file in the Specs tab. Editable files carry what OpenRig needs to save them safely. */
export interface SpecFile {
  name: "rig.yaml" | "CULTURE.md";
  content: string;
  editable: boolean;
  /** Why it is read-only, when it is. */
  reason?: string;
  root?: string;
  path?: string;
  mtime?: string;
  hash?: string;
}

export interface SnapshotInfo {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
}

/** One account usage window, e.g. Claude's five-hour or weekly limit. */
export interface UsageWindow {
  provider: string;
  window: string;
  usedPercent: number;
  resetsAt: string;
  asOf: string;
}

export interface SearchHit {
  session: string;
  logicalId: string;
  line: string;
}

/** A rig spec OpenRig ships or knows about, to start a new project from. */
export interface LibrarySpec {
  id: string;
  name: string;
  version: string;
  summary: string;
  sourcePath: string;
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
  /** The rig's terminal seat: messages from RigApp are signed as this seat, the human. */
  human: string | null;
  pods: Pod[];
  /** Links between seats, by session name, e.g. `delegates_to`. */
  edges: Edge[];
}

export interface Edge {
  from: string;
  to: string;
  kind: string;
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

/** Where the desktop app's updater is; the web UI shows it in Settings and as a banner. */
export interface UpdateState {
  status: "idle" | "checking" | "none" | "downloading" | "ready" | "error";
  /** The version found, when there is one. */
  version?: string;
  /** Release notes as Markdown, from the GitHub release. */
  notes?: string;
  percent?: number;
  error?: string;
}

/** What the desktop app's preload exposes as `window.rigapp`. Absent in a plain browser. */
export interface DesktopBridge {
  version: string;
  getUpdate(): Promise<UpdateState>;
  onUpdate(listener: (state: UpdateState) => void): () => void;
  checkForUpdates(): Promise<void>;
  installUpdate(): void;
}

/** Saved in settings.json in RigApp's data folder and applied as soon as it changes. */
export interface Settings {
  theme: "system" | "dark" | "light";
  /** Empty: find the daemon by itself (RIGAPP_DAEMON_URL, then ~/.openrig/daemon.json). */
  daemonUrl: string;
  /** Only the keys you changed, by command id; the UI holds the defaults. */
  keybindings: Record<string, string>;
  /** Panels that talk to local tools. Off until you turn them on; none of them adds anything to a seat. */
  tools: { hindsight: boolean; hindsightUrl: string; codegraph: boolean };
}

export interface Shell {
  daemon: DaemonInfo;
  /** Filled while the daemon is unreachable, empty once it answers. */
  checks: SetupCheck[];
  platform: "windows" | "linux";
  projects: Project[];
  settings: Settings;
  /** RigApp's own version, from its package.json. */
  version: string;
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
  /**
   * A seat's terminal. `live`: raw output from the daemon's terminal socket, to append.
   * `preview`: the whole pane as text, re-read every few seconds, to replace. `ended`: the socket closed.
   */
  | { type: "term"; session: string; mode: "live" | "preview" | "ended"; data?: string; screen?: string }
  /** `reason` is the daemon's refusal code when it refused a send. */
  | {
      type: "result";
      id: number;
      ok: boolean;
      error?: string;
      reason?: string;
      files?: FileEntry[];
      text?: string;
      /** The answer to a specs, rig, usage or search request (see each method). */
      data?: unknown;
    };

/** UI to server. */
export type ClientMessage =
  | { id: number; method: "setup.recheck" }
  | { id: number; method: "thread.subscribe" | "thread.unsubscribe"; session: string }
  /** `force` sends even when the seat is busy (the daemon's `mid_work` refusal). */
  | { id: number; method: "seat.send"; session: string; text: string; force?: boolean }
  | { id: number; method: "seat.key"; session: string; key: "approve" | "deny" | "stop" }
  /** Read-only look at the seat's folder; `path` is relative to it ("" is the folder itself). */
  | { id: number; method: "files.list" | "files.read"; session: string; path: string }
  | { id: number; method: "term.subscribe" | "term.unsubscribe"; session: string }
  /** Keys typed in the terminal while you have taken control, as xterm reports them. */
  | { id: number; method: "term.input"; session: string; data: string }
  /** Answers SpecFile[]. */
  | { id: number; method: "specs.load"; rigId: string }
  /** Answers { valid, errors } from OpenRig's RigSpec validator. */
  | { id: number; method: "specs.validate"; content: string }
  | { id: number; method: "specs.save"; rigId: string; root: string; path: string; content: string; mtime: string; hash: string }
  /** `plan` only forecasts; without it the rig starts (its seats spend tokens). */
  | { id: number; method: "rig.up"; rigId: string; plan: boolean }
  | { id: number; method: "rig.down"; rigId: string; snapshot: boolean }
  /** rig.snapshots answers SnapshotInfo[]; rig.snapshot takes one now. */
  | { id: number; method: "rig.snapshots" | "rig.snapshot"; rigId: string }
  | { id: number; method: "rig.restore"; rigId: string; snapshotId: string }
  /** Answers LibrarySpec[] (rig specs only). */
  | { id: number; method: "library" }
  /** Starts a new rig from a spec path in a project folder (a Linux path); `plan` only forecasts. */
  | { id: number; method: "up.spec"; sourceRef: string; plan: boolean; cwd: string; rigName: string }
  /** Answers UsageWindow[]. */
  | { id: number; method: "usage" }
  /** Answers SearchHit[] from every seat's pane log. */
  | { id: number; method: "search"; pattern: string }
  | { id: number; method: "settings.set"; patch: Partial<Settings> }
  /** tools.banks answers string[]; tools.recall answers { id, text }[]. */
  | { id: number; method: "tools.banks" }
  /** Answers { mcptoon: version or null, hindsight: whether mcptoon has a hindsight server }. */
  | { id: number; method: "tools.seatTools" }
  | { id: number; method: "tools.recall"; bank: string; query: string }
  /** Answers { folder, text }: CodeGraph's explore output for the seat's folder. */
  | { id: number; method: "tools.explore"; session: string; query: string };
