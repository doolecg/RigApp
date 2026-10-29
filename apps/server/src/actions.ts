import { execFile } from "node:child_process";
import type { Seat } from "@rigapp/contracts";

/** An action, or the number of a choice in the seat's prompt ("1" to "9"). */
export type SeatKey = "approve" | "deny" | "stop" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/**
 * The keys for each action: Enter picks the highlighted first choice ("Yes") on a
 * permission prompt, Escape declines it or stops a working turn.
 */
const KEYS: Record<string, string> = { approve: "Enter", deny: "Escape", stop: "Escape" };

/** Plain words for the daemon's 409 refusal reasons (transport.ts, session-transport.ts). */
const REFUSALS: Record<string, string> = {
  mid_work: "The seat is busy with a turn.",
  target_needs_input: "The seat is waiting on a prompt. Answer it first.",
  typing_guard_enabled: "Someone is typing in the seat's terminal.",
  target_activity_unknown: "OpenRig can't tell whether the seat is free.",
  draft_input_busy: "The seat's input box already has text in it.",
  session_missing: "The seat's tmux session is gone.",
  tmux_unavailable: "tmux is not answering in WSL.",
};

export interface SendResult {
  ok: boolean;
  /** Set when the daemon refused; the UI can then offer to send anyway. */
  reason?: string;
  error?: string;
}

/**
 * Sends text to a seat through `POST /api/transport/send`. The rig's terminal seat
 * signs it (`X-OpenRig-Session`), as the human at the keyboard; with no terminal seat
 * the daemon labels it an unknown sender.
 */
export async function sendText(url: string, seat: Seat, sender: string | null, text: string, force: boolean): Promise<SendResult> {
  const res = await fetch(`${url}/api/transport/send`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(sender ? { "x-openrig-session": sender } : {}) },
    body: JSON.stringify({ session: seat.session, text, ...(force ? { force: true } : {}) }),
    signal: AbortSignal.timeout(30000),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string; error?: string; outcome?: string };
  if (res.ok && body.ok !== false && body.outcome !== "failed") return { ok: true };
  const reason = body.reason ?? (res.status === 404 ? "session_missing" : undefined);
  return { ok: false, reason, error: (reason && REFUSALS[reason]) ?? body.error ?? `OpenRig answered ${res.status}.` };
}

/** Sends one key to the seat's tmux pane: through wsl.exe on Windows, locally on Linux. */
function send(distro: string | null, session: string, key: string): Promise<SendResult> {
  const args = ["tmux", "send-keys", "-t", session, key];
  const [cmd, argv] = distro ? ["wsl.exe", ["-d", distro, "-e", ...args]] : ["tmux", args.slice(1)];
  return new Promise((resolve) => {
    execFile(cmd, argv as string[], { windowsHide: true, timeout: 10000 }, (err, _out, stderr) => {
      resolve(err ? { ok: false, error: String(stderr).trim() || err.message } : { ok: true });
    });
  });
}

/**
 * Presses a key in the seat's tmux pane. OpenRig has no approve, deny or interrupt
 * route (systems.md gaps 2 and 3), so this goes to tmux directly.
 *
 * The keys above hold for Claude Code and Codex (its prompt reads "1. Yes, proceed (y)" ...
 * "3. No, and tell Codex what to do differently (esc)", and its running status says "esc to
 * interrupt"). OpenCode's permission prompt (Allow once / Always allow / Reject) also takes Enter
 * and Escape, but it stops a turn only on a second Escape: the first arms it ("again to interrupt").
 */
export async function pressKey(distro: string | null, seat: Seat, key: SeatKey): Promise<SendResult> {
  if (!(key in KEYS) && !/^[1-9]$/.test(key)) return { ok: false, error: `RigApp does not press "${key}".` };
  // A digit picks that numbered choice in the seat's prompt.
  const first = await send(distro, seat.session, KEYS[key] ?? key);
  if (key !== "stop" || !first.ok || !/opencode/i.test(seat.runtime)) return first;
  await new Promise((resolve) => setTimeout(resolve, 400));
  return send(distro, seat.session, KEYS.stop!);
}
