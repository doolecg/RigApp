import type { Activity, Pod, Project, Seat } from "@rigapp/contracts";
import type { NodeEntry, PsEntry, RigDetail } from "./types.ts";

const HARNESS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  pi: "Pi",
  terminal: "Terminal",
};

const ACTIVITIES: Activity[] = ["running", "needs_input", "idle", "unknown"];

function errorText(error: unknown): string | null {
  if (error == null) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return JSON.stringify(error);
}

function toSeat(node: NodeEntry): Seat {
  const dot = node.logicalId.indexOf(".");
  const state = node.agentActivity?.state as Activity | undefined;
  return {
    session: node.canonicalSessionName,
    logicalId: node.logicalId,
    pod: node.podNamespace ?? node.logicalId.slice(0, dot),
    member: node.logicalId.slice(dot + 1),
    runtime: node.runtime,
    harness: HARNESS[node.runtime] ?? node.runtime,
    kind: node.nodeKind,
    status: node.sessionStatus,
    activity: state && ACTIVITIES.includes(state) ? state : "unknown",
    startup: node.startupStatus,
    error: errorText(node.latestError),
    restorePolicy: node.restorePolicy,
    agentRef: node.agentRef,
    cwd: node.cwd,
    contextPercent: node.contextUsage?.usedPercentage ?? null,
    attachCommand: node.tmuxAttachCommand,
    transcriptPath: node.contextUsage?.transcriptPath ?? null,
    lastActivityAt: node.lastActivityAt ?? null,
    prompt: null,
  };
}

/**
 * The seat you talk to: the rig's `representative`, else the first `delegates_to`
 * root (delegates but is delegated to by no one), else the first agent seat.
 * OpenRig has no lead field of its own (systems.md gap 8).
 */
export function pickLead(rig: RigDetail, nodes: NodeEntry[]): string | null {
  if (rig.representative) return rig.representative;
  const delegates = rig.edges.filter((e) => e.kind === "delegates_to");
  const targets = new Set(delegates.map((e) => e.targetId));
  const root = nodes.find((n) => delegates.some((e) => e.sourceId === n.nodeId) && !targets.has(n.nodeId));
  return (root ?? nodes.find((n) => n.nodeKind === "agent"))?.canonicalSessionName ?? null;
}

export function buildProject(ps: PsEntry, rig: RigDetail, nodes: NodeEntry[]): Project {
  // Pods keep the daemon's node order, which follows the rig spec.
  const pods: Pod[] = [];
  for (const seat of nodes.map(toSeat)) {
    const pod = pods.find((p) => p.name === seat.pod);
    if (pod) pod.seats.push(seat);
    else pods.push({ name: seat.pod, seats: [seat] });
  }
  return {
    id: ps.rigId,
    name: ps.name,
    status: ps.status,
    uptime: ps.uptime,
    latestSnapshot: ps.latestSnapshot,
    lead: pickLead(rig, nodes),
    human: nodes.find((n) => n.runtime === "terminal")?.canonicalSessionName ?? null,
    pods,
  };
}
