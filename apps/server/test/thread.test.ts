import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { ServerMessage } from "@rigapp/contracts";
import { Thread } from "../src/chat/thread.ts";

const lines = readFileSync(new URL("fixtures/claude-session.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean);
const dir = mkdtempSync(join(tmpdir(), "rigapp-thread-"));
let thread: Thread | undefined;

afterEach(() => {
  thread?.stop();
  rmSync(dir, { recursive: true, force: true });
});

it("sends lines appended to the session file, including a half-written one once it is finished", async () => {
  const file = join(dir, "session.jsonl");
  const cut = lines.findIndex((l) => l.includes('"tool_result"'));
  writeFileSync(file, lines.slice(0, cut).join("\n") + "\n");
  thread = new Thread("advisor-lead@kernel", file);
  await thread.ready;
  const before = thread.snapshot();
  expect(before.type === "thread" && before.items.length).toBeGreaterThan(0);

  const update = new Promise<ServerMessage>((resolve) => thread!.listeners.add(resolve));
  // Write the result line in two parts, as a harness flushing mid-line would.
  const rest = lines.slice(cut).join("\n") + "\n";
  appendFileSync(file, rest.slice(0, 40));
  await new Promise((r) => setTimeout(r, 1200));
  appendFileSync(file, rest.slice(40));
  const message = await update;
  expect(message).toMatchObject({ type: "thread", reset: false });
  expect(message.type === "thread" && message.items[0]).toMatchObject({ kind: "tool", name: "Bash" });
});
