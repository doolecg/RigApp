import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ClaudeParser } from "../src/chat/claude.ts";

// The user and assistant lines of the real advisor.lead session on the kernel rig
// (Claude Code, 2026-10-29). Bookkeeping lines were dropped to keep it small.
const lines = readFileSync(new URL("fixtures/claude-session.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);

describe("ClaudeParser", () => {
  it("reads messages and pairs the tool call with its result", () => {
    const items = new ClaudeParser().parse(lines);
    expect(items[0]?.kind).toBe("user");
    const tool = items.find((i) => i.kind === "tool");
    expect(tool).toMatchObject({ kind: "tool", name: "Bash", input: { command: "rig whoami --json" }, error: false });
    expect(tool?.kind === "tool" && tool.result).toContain('"logicalId":"advisor.lead"');
    expect(items.some((i) => i.kind === "assistant" && i.text.length > 0)).toBe(true);
  });

  it("fills in a tool result that arrives in a later read", () => {
    const parser = new ClaudeParser();
    const cut = lines.findIndex((l) => l.includes('"tool_result"'));
    const first = parser.parse(lines.slice(0, cut));
    expect(first.find((i) => i.kind === "tool")).toMatchObject({ result: null });
    const second = parser.parse(lines.slice(cut));
    expect(second[0]).toMatchObject({ kind: "tool", name: "Bash" });
    expect(second[0]?.kind === "tool" && second[0].result).toBeTruthy();
  });

  it("skips lines it cannot read", () => {
    expect(new ClaudeParser().parse(["{not json", '{"type":"summary"}'])).toEqual([]);
  });
});
