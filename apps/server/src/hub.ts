import type { ServerMessage, Shell } from "@rigapp/contracts";
import { health, loadProjects } from "./openrig/client.ts";
import { followSse } from "./openrig/sse.ts";
import { platform, runChecks } from "./setup.ts";

// Streams that tell us something changed; on each frame we re-read /api/ps and
// the seats, as the OpenRig TUI does. `replay=0` matters: without it the daemon
// replays its whole event log.
const STREAMS = ["/api/events?replay=0", "/api/activity/events"];

/** Holds the latest shell (daemon state plus projects) and tells listeners when it changes. */
export class Hub {
  private shell: Shell = {
    daemon: { url: "", ok: false, version: null, host: "" },
    checks: [],
    platform,
    projects: [],
  };
  private json = "";
  private seq = 0;
  private follow: AbortController | null = null;
  private retry: NodeJS.Timeout | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private refreshAgain = false;
  readonly listeners = new Set<(message: ServerMessage) => void>();

  message(): ServerMessage {
    return { type: "shell", seq: this.seq, shell: this.shell };
  }

  /** Full check: find the daemon, and if it is down, check WSL, tmux and the CLI. */
  async check(): Promise<void> {
    clearTimeout(this.retry);
    const result = await runChecks();
    this.shell.daemon = { url: result.url, ok: !!result.version, version: result.version, host: result.host };
    this.shell.checks = result.checks;
    if (result.version) {
      this.startFollowing();
      await this.refresh();
    } else {
      this.stopFollowing();
      this.shell.projects = [];
      this.publish();
      this.retry = setTimeout(() => void this.poll(), 5000);
    }
  }

  /** While the daemon is down, only ask its health until it answers. */
  private async poll(): Promise<void> {
    if (await health(this.shell.daemon.url)) await this.check();
    else this.retry = setTimeout(() => void this.poll(), 5000);
  }

  private startFollowing(): void {
    if (this.follow) return;
    const control = new AbortController();
    this.follow = control;
    for (const path of STREAMS) {
      followSse(this.shell.daemon.url + path, () => this.scheduleRefresh(), control.signal)
        .catch(() => {})
        .finally(() => {
          // A stream that ends on its own means the daemon stopped or restarted.
          if (!control.signal.aborted) this.lost();
        });
    }
  }

  private stopFollowing(): void {
    this.follow?.abort();
    this.follow = null;
  }

  private lost(): void {
    this.stopFollowing();
    void this.check();
  }

  /** Activity events can come many times a second; re-read at most every 300 ms. */
  private scheduleRefresh(): void {
    this.refreshTimer ??= setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 300);
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    this.refreshing = true;
    try {
      this.shell.projects = await loadProjects(this.shell.daemon.url);
      this.publish();
    } catch {
      this.lost();
    } finally {
      this.refreshing = false;
    }
    if (this.refreshAgain) {
      this.refreshAgain = false;
      await this.refresh();
    }
  }

  private publish(): void {
    const json = JSON.stringify(this.shell);
    if (json === this.json) return;
    this.json = json;
    this.seq++;
    const message = this.message();
    for (const listener of this.listeners) listener(message);
  }
}
