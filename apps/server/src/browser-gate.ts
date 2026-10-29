import type { BrowserAsk, BrowserLogEntry, BrowserState, ServerMessage } from "@rigapp/contracts";

// What stands between a seat and the seat browser: every Playwright tool call asks you first
// (Allow once / Allow all / Deny), is refused while you hold the browser, and lands in a log.
// Ported in spirit from Operant's browser gate, cut down to these four jobs.

/** Tools that only look at the page. They are logged but never ask. */
const READ_ONLY = new Set([
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_console_messages",
  "browser_network_requests",
  "browser_network_request",
  "browser_wait_for",
  "browser_find",
]);

const ASK_TIMEOUT_MS = 5 * 60_000;
const LOG_LIMIT = 100;

type Listener = (message: ServerMessage) => void;

interface Waiting extends BrowserAsk {
  settle: (allowed: boolean, reason?: string) => void;
}

const text = (value: unknown, max = 80): string => {
  const one = String(value ?? "").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}...` : one;
};

/** One line saying what a call will do. Typed text and script bodies are never copied: they can hold passwords. */
export function summarise(tool: string, args: Record<string, unknown>): string {
  const target = text(args.element ?? args.ref ?? "");
  switch (tool) {
    case "browser_navigate":
      return `Open ${text(args.url, 120)}`;
    case "browser_click":
      return `Click ${target || "an element"}`;
    case "browser_type":
      return `Type ${String(args.text ?? "").length} characters into ${target || "an element"}`;
    case "browser_fill_form":
      return `Fill in ${Array.isArray(args.fields) ? args.fields.length : "some"} form fields`;
    case "browser_press_key":
      return `Press ${text(args.key, 30)}`;
    case "browser_evaluate":
    case "browser_run_code_unsafe":
      return "Run a script in the page";
    case "browser_tabs":
      return `Tabs: ${text(args.action ?? "list", 20)}`;
    default:
      return tool.replace(/^browser_/, "").replace(/_/g, " ") + (target ? `: ${target}` : "");
  }
}

class Gate {
  listeners = new Set<Listener>();
  running = false;
  page: BrowserState["page"] = null;
  control = false;
  allowAll = false;
  private waiting: Waiting[] = [];
  private log: BrowserLogEntry[] = [];
  private nextId = 1;

  state(): BrowserState {
    return {
      running: this.running,
      page: this.page,
      control: this.control,
      allowAll: this.allowAll,
      asks: this.waiting.map(({ id, tool, summary }) => ({ id, tool, summary })),
      log: this.log,
    };
  }

  publish(): void {
    const message: ServerMessage = { type: "browser", state: this.state() };
    for (const listener of this.listeners) listener(message);
  }

  private record(tool: string, summary: string, outcome: BrowserLogEntry["outcome"]): void {
    this.log = [...this.log, { id: this.nextId++, at: Date.now(), tool, summary, outcome }].slice(-LOG_LIMIT);
  }

  /** The browser started or stopped: a fresh start forgets "Allow all", the log and any hold. */
  setRunning(running: boolean): void {
    this.running = running;
    if (!running) {
      for (const ask of this.waiting) ask.settle(false, "The browser was turned off.");
      this.waiting = [];
      this.page = null;
      this.control = false;
      this.allowAll = false;
      this.log = [];
    }
    this.publish();
  }

  /** Decides one tool call from a seat. Resolves once it may run, or with the reason it may not. */
  async check(tool: string, args: Record<string, unknown>): Promise<{ ok: true } | { ok: false; reason: string }> {
    const summary = summarise(tool, args);
    if (this.control) {
      this.record(tool, summary, "paused");
      this.publish();
      return { ok: false, reason: "The person using RigApp has taken control of the browser. Wait, then try again." };
    }
    if (READ_ONLY.has(tool) || this.allowAll) {
      this.record(tool, summary, "ran");
      this.publish();
      return { ok: true };
    }
    const id = this.nextId++;
    const answer = await new Promise<{ allowed: boolean; reason?: string }>((resolve) => {
      const timer = setTimeout(() => this.answer(id, "deny", "Nobody answered within 5 minutes."), ASK_TIMEOUT_MS);
      this.waiting.push({
        id,
        tool,
        summary,
        settle: (allowed, reason) => {
          clearTimeout(timer);
          resolve({ allowed, reason });
        },
      });
      this.publish();
    });
    this.record(tool, summary, answer.allowed ? "allowed" : "denied");
    this.publish();
    return answer.allowed ? { ok: true } : { ok: false, reason: answer.reason ?? "The person using RigApp denied this browser action." };
  }

  answer(id: number, answer: "once" | "all" | "deny", reason?: string): boolean {
    const ask = this.waiting.find((w) => w.id === id);
    if (!ask) return false;
    this.waiting = this.waiting.filter((w) => w !== ask);
    if (answer === "all") this.allowAll = true;
    ask.settle(answer !== "deny", reason);
    // "Allow all" also lets through whatever else is already waiting.
    if (answer === "all") for (const other of this.waiting.splice(0)) other.settle(true);
    return true;
  }

  /** Taking control refuses new seat actions and denies the ones still waiting. */
  setControl(on: boolean): void {
    this.control = on;
    if (on) {
      for (const ask of this.waiting.splice(0)) ask.settle(false, "The person using RigApp has taken control of the browser.");
    }
    this.publish();
  }
}

export const gate = new Gate();
