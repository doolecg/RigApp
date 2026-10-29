import type { Seat } from "@rigapp/contracts";

export type Tone = "acc" | "warn" | "err" | "idle";

/** One word for what a seat is doing, and the colour of its dot. */
export function seatState(seat: Seat): { tone: Tone; label: string } {
  if (seat.error || seat.startup === "failed") return { tone: "err", label: "Error" };
  if (seat.status !== "running") return { tone: "idle", label: "Stopped" };
  // A terminal seat's "activity" is only screen motion, not work.
  if (seat.kind !== "agent") return { tone: "idle", label: "Running" };
  if (seat.activity === "running") return { tone: "acc", label: "Working" };
  if (seat.activity === "needs_input") return { tone: "warn", label: "Waiting on you" };
  if (seat.activity === "idle") return { tone: "idle", label: "Idle" };
  return { tone: "idle", label: "Running" };
}

export function title(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
