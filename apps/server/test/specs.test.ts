import { describe, expect, it } from "vitest";
import { agentFolder } from "../src/lifecycle.ts";

// agent_ref values as OpenRig 0.7.4 reports them for the kernel and starter rigs.
describe("agentFolder", () => {
  it("resolves local: refs against the rig folder", () => {
    expect(agentFolder("local:agents/advisor/lead", "/specs/rigs/launch/kernel")).toBe("/specs/rigs/launch/kernel/agents/advisor/lead");
    expect(agentFolder("local:../shared", "/specs/rigs/kernel")).toBe("/specs/rigs/shared");
  });
  it("takes path: refs as they are", () => {
    expect(agentFolder("path:/opt/specs/agents/development/qa", "/anywhere")).toBe("/opt/specs/agents/development/qa");
  });
  it("has no folder for builtin: or empty refs", () => {
    expect(agentFolder("builtin:terminal", "/x")).toBeNull();
    expect(agentFolder("local:", "/x")).toBeNull();
    expect(agentFolder("path:", "/x")).toBeNull();
  });
});
