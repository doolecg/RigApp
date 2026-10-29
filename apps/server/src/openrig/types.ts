// The parts of the daemon's responses RigApp reads. Shapes checked against
// OpenRig 0.7.4 (fixtures in test/fixtures are real responses).

/** One row of `GET /api/ps`. */
export interface PsEntry {
  rigId: string;
  name: string;
  status: string;
  uptime: string | null;
  latestSnapshot: string | null;
  isArchived: boolean;
}

/** `GET /api/rigs/:rigId` */
export interface RigDetail {
  representative: string | null;
  edges: { sourceId: string; targetId: string; kind: string }[];
}

/** One row of `GET /api/rigs/:rigId/nodes`. */
export interface NodeEntry {
  nodeId: string;
  logicalId: string;
  podNamespace: string | null;
  canonicalSessionName: string;
  nodeKind: string;
  runtime: string;
  sessionStatus: string;
  startupStatus: string;
  latestError: unknown;
  restorePolicy: string | null;
  agentRef: string | null;
  cwd: string | null;
  tmuxAttachCommand: string | null;
  agentActivity: { state: string } | null;
  contextUsage: { usedPercentage: number | null } | null;
}

/** `GET /healthz` */
export interface Health {
  status: string;
  semver: string;
}
