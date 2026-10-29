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

/** A rig's spec, culture or agent file in the Specs tab. Editable files carry what OpenRig needs to save them safely. */
export interface SpecFile {
  /** Unique within the list: the file name, or the agent_ref for an agent. */
  id: string;
  /** What the tab shows: the file name, or the agent's name. */
  name: string;
  kind: "rig" | "culture" | "agent";
  content: string;
  editable: boolean;
  /** Why it is read-only, when it is. */
  reason?: string;
  root?: string;
  path?: string;
  mtime?: string;
  hash?: string;
}

/** A tmux session OpenRig found that no rig owns yet. */
export interface FoundSession {
  id: string;
  session: string;
  cwd: string | null;
  runtime: string;
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
  /** OpenRig's pod id, needed to adopt a session into the pod. */
  id: string;
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
  /** `browser` starts a headless browser that seats reach through mcptoon. */
  tools: { hindsight: boolean; hindsightUrl: string; codegraph: boolean; browser: boolean; localModels: string[] };
}

/** One local model server that answered `/v1/models`. */
export interface LocalModelServer {
  /** Ollama, LM Studio, llama.cpp, or "Custom" for an address you added. */
  name: string;
  /** Base address, e.g. http://localhost:11434 . */
  url: string;
  models: string[];
}

/** A seat browser action waiting for your answer. */
export interface BrowserAsk {
  id: number;
  /** The Playwright tool, e.g. browser_navigate. */
  tool: string;
  /** What it will do, in words; typed text is never shown. */
  summary: string;
}

export interface BrowserLogEntry {
  id: number;
  at: number;
  tool: string;
  summary: string;
  outcome: "ran" | "allowed" | "denied" | "paused";
}

/** The seat browser: pushed to every connected UI whenever it changes. */
export interface BrowserState {
  running: boolean;
  /** The page seats and you are looking at. */
  page: { url: string; title: string } | null;
  /** You hold the browser: seat actions are refused until you hand it back. */
  control: boolean;
  /** Seat actions run without asking until the browser is turned off. */
  allowAll: boolean;
  asks: BrowserAsk[];
  /** Newest last. */
  log: BrowserLogEntry[];
}

/** What you do in the Browser tab while you hold the browser. Positions are CSS pixels of the page. */
export type BrowserInput =
  | { kind: "mouse"; type: "move" | "down" | "up"; x: number; y: number; button: "left" | "middle" | "right"; clicks: number }
  | { kind: "wheel"; x: number; y: number; dx: number; dy: number }
  | { kind: "key"; type: "down" | "up"; key: string; code: string; keyCode: number; text: string; modifiers: number }
  | { kind: "text"; text: string };

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
  | { type: "browser"; state: BrowserState }
  /** A picture (base64 JPEG) of the seat browser's page, sent only while a Browser tab is open. width and height are the page size in CSS pixels. */
  | { type: "browser.frame"; data: string; width: number; height: number }
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
  /** A digit presses that numbered choice in the seat's prompt, e.g. "don't ask again". */
  | { id: number; method: "seat.key"; session: string; key: "approve" | "deny" | "stop" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" }
  /** Read-only look at the seat's folder; `path` is relative to it ("" is the folder itself). */
  | { id: number; method: "files.list" | "files.read"; session: string; path: string }
  | { id: number; method: "term.subscribe" | "term.unsubscribe"; session: string }
  /** Keys typed in the terminal while you have taken control, as xterm reports them. */
  | { id: number; method: "term.input"; session: string; data: string }
  /** Answers SpecFile[]. */
  | { id: number; method: "specs.load"; rigId: string }
  /** Answers { valid, errors } from OpenRig's RigSpec validator. */
  | { id: number; method: "specs.validate"; content: string; agent?: boolean }
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
  /** Scans tmux for sessions no rig owns; answers FoundSession[]. */
  | { id: number; method: "adopt.scan" }
  /** Adds a found session to a pod as a new member. */
  | { id: number; method: "adopt"; discoveryId: string; rigId: string; podId: string; podName: string; member: string }
  /** Packs the rig's spec into a .rigbundle in the daemon's workspace; answers { path }. */
  | { id: number; method: "bundle.create"; rigId: string }
  /** Answers OpenRig's description of a bundle (a daemon-side path). */
  | { id: number; method: "bundle.inspect"; path: string }
  /** Installs a bundle into a folder (Linux paths); `plan` only forecasts. */
  | { id: number; method: "bundle.install"; path: string; targetRoot: string; plan: boolean }
  /** Opens the system folder picker on this computer; answers { path } (null when cancelled). */
  | { id: number; method: "pick.folder" }
  | { id: number; method: "tools.banks" }
  /** Answers LocalModelServer[]: the OpenAI-compatible servers found on this PC and the models each one lists. */
  | { id: number; method: "tools.localModels" }
  /** Answers { mcptoon, hindsight, codegraph, browser }: versions or null, and the browser's address while it runs. */
  | { id: number; method: "tools.seatTools" }
  | { id: number; method: "tools.recall"; bank: string; query: string }
  | { id: number; method: "browser.watch" | "browser.unwatch" }
  /** once: run this action; all: run this and every later one until the browser is turned off. */
  | { id: number; method: "browser.answer"; ask: number; answer: "once" | "all" | "deny" }
  | { id: number; method: "browser.control"; on: boolean }
  | { id: number; method: "browser.input"; event: BrowserInput }
  | { id: number; method: "browser.go"; url: string }
  /** Answers { folder, text }: CodeGraph's explore output for the seat's folder. */
  | { id: number; method: "tools.explore"; session: string; query: string };
