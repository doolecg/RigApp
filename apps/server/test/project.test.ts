import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProject, pickLead } from "../src/openrig/project.ts";
import type { NodeEntry, PsEntry, RigDetail } from "../src/openrig/types.ts";

// Real responses from OpenRig 0.7.4, saved by scripts/record-fixtures.ts.
const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));
const ps = load<PsEntry[]>("ps");
const rig = (name: string) => ({
  ps: ps.find((p) => p.name === name)!,
  detail: load<RigDetail>(`rig-${name}`),
  nodes: load<NodeEntry[]>(`nodes-${name}`),
});

describe("buildProject", () => {
  it("groups the kernel rig's seats by pod in spec order", () => {
    const { ps, detail, nodes } = rig("kernel");
    const project = buildProject(ps, detail, nodes);
    expect(project.name).toBe("kernel");
    expect(project.pods.map((p) => [p.name, p.seats.map((s) => s.member)])).toEqual([
      ["advisor", ["lead"]],
      ["operator", ["agent", "human"]],
      ["queue", ["worker"]],
    ]);
  });

  it("labels harnesses and reads seat state", () => {
    const { ps, detail, nodes } = rig("kernel");
    const seats = buildProject(ps, detail, nodes).pods.flatMap((p) => p.seats);
    const lead = seats.find((s) => s.logicalId === "advisor.lead")!;
    expect(lead.session).toBe("advisor-lead@kernel");
    expect(lead.harness).toBe("Claude Code");
    expect(lead.status).toBe("running");
    expect(["running", "needs_input", "idle", "unknown"]).toContain(lead.activity);
    expect(seats.find((s) => s.logicalId === "operator.human")!.harness).toBe("Terminal");
  });

  it("reads a stopped rig", () => {
    const { ps, detail, nodes } = rig("starter");
    const project = buildProject(ps, detail, nodes);
    expect(project.status).toBe("stopped");
    expect(project.pods[0]!.seats.every((s) => s.status === "exited")).toBe(true);
  });
});

describe("pickLead", () => {
  it("uses the rig's representative", () => {
    const { detail, nodes } = rig("kernel");
    expect(pickLead(detail, nodes)).toBe("advisor-lead@kernel");
  });

  it("falls back to the delegates_to root", () => {
    const { detail, nodes } = rig("starter");
    expect(pickLead({ ...detail, representative: null }, nodes)).toBe("dev-build@starter");
  });

  it("falls back to the first agent seat when nothing delegates", () => {
    const { nodes } = rig("kernel");
    expect(pickLead({ representative: null, edges: [] }, nodes)).toBe("advisor-lead@kernel");
  });
});
