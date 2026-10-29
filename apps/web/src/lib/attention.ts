import type { Project, Seat, Shell } from "@rigapp/contracts";
import { isUnread } from "./seen";

export type Group = "waiting" | "errored" | "finished" | "working" | "idle";

export const GROUPS: { id: Group; title: string; tone: "warn" | "err" | "acc" | "idle"; empty: string }[] = [
  { id: "waiting", title: "Waiting on you", tone: "warn", empty: "Nothing is waiting on you." },
  { id: "errored", title: "Errored", tone: "err", empty: "No errors." },
  { id: "finished", title: "Finished, ready to review", tone: "acc", empty: "Nothing to review." },
  { id: "working", title: "Working", tone: "acc", empty: "No seat is working." },
  { id: "idle", title: "Idle", tone: "idle", empty: "" },
];

export interface Entry {
  project: Project;
  seat: Seat;
  group: Group;
}

export function groupOf(seat: Seat, seen: Record<string, string>): Group {
  if (seat.activity === "needs_input") return "waiting";
  if (seat.error || seat.startup === "failed") return "errored";
  // Terminal seats count as idle: their "activity" is just screen motion.
  if (seat.kind !== "agent") return "idle";
  if (seat.status === "running" && seat.activity === "running") return "working";
  if (seat.kind === "agent" && isUnread(seat, seen)) return "finished";
  return "idle";
}

export function entries(shell: Shell, seen: Record<string, string>): Entry[] {
  return shell.projects.flatMap((project) =>
    project.pods.flatMap((pod) => pod.seats.map((seat) => ({ project, seat, group: groupOf(seat, seen) }))),
  );
}

/** How many seats need you: waiting or errored. */
export function needsYou(list: Entry[]): number {
  return list.filter((e) => e.group === "waiting" || e.group === "errored").length;
}

/** The question line of a waiting seat's pane: the last line with a "?", else its first line. */
export function question(seat: Seat): string {
  const lines = (seat.prompt ?? "")
    .split("\n")
    .map((l) => l.replace(/[│╭╮╰╯─]/g, "").trim())
    .filter(Boolean);
  return lines.findLast((l) => l.includes("?")) ?? lines[0] ?? "Waiting for an answer";
}

export function ago(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}
