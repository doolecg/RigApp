import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { ChatItem, ServerMessage } from "@rigapp/contracts";
import { AntigravityParser } from "../src/chat/antigravity.ts";
import { CodexParser } from "../src/chat/codex.ts";
import { normalizeTool } from "../src/chat/common.ts";
import { formatOf, sameDir } from "../src/chat/locate.ts";
import { OpenCodeSource, opencodeFile } from "../src/chat/opencode.ts";
import { PiParser } from "../src/chat/pi.ts";
import { Thread } from "../src/chat/thread.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const lines = (name: string) => fixture(name).split("\n").filter(Boolean);
const dir = mkdtempSync(join(tmpdir(), "rigapp-harness-"));
let thread: Thread | undefined;

afterEach(() => thread?.stop());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Tool = Extract<ChatItem, { kind: "tool" }>;
const tools = (items: ChatItem[]) => items.filter((i): i is Tool => i.kind === "tool");

describe("which reader a runtime gets", () => {
  it("maps built-in and community runtime names", () => {
    expect(["claude-code", "codex", "pi", "pi-tui", "opencode", "my-opencode", "antigravity", "agy", "terminal", "cursor"].map(formatOf)).toEqual([
      "claude", "codex", "pi", "pi", "opencode", "opencode", "antigravity", "antigravity", null, null,
    ]);
  });

  it("compares folders the way harnesses write them", () => {
    expect(sameDir("/mnt/e/REPOS/AI TOOLS/x/", "E:\\repos\\ai tools\\x")).toBe(true);
    expect(sameDir("/home/doole/a", "/home/doole/b")).toBe(false);
  });

  it("renames tools to the names the chat card knows, and leaves the rest", () => {
    expect(normalizeTool("edit", { path: "a", oldString: "x", newString: "y" })).toEqual({
      name: "Edit",
      input: { file_path: "a", old_string: "x", new_string: "y" },
    });
    expect(normalizeTool("spawn_agent", { path: "a" })).toEqual({ name: "spawn_agent", input: { path: "a" } });
  });
});

describe("CodexParser", () => {
  // Real lines from codex 0.165 (WSL, 2026-10-29). That run failed to log in (401), so the file has
  // the prompt but no reply or tool calls.
  it("reads the prompt from a real rollout and skips Codex's own context messages", () => {
    const items = new CodexParser().parse(lines("codex-rollout.jsonl"));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "user", text: expect.stringContaining("cat note.txt") });
  });

  // No real Codex rollout with a reply or a tool call exists on this PC. These lines follow the
  // OpenAI Responses shapes Codex writes, as OpenRig's codex-jsonl-parser and TokenEconomizer's
  // trace/codex.py describe them. They check the code, they are not recorded output.
  const synthetic = [
    { type: "response_item", payload: { type: "message", id: "m1", role: "assistant", content: [{ type: "output_text", text: "Running it." }] } },
    { type: "response_item", payload: { type: "function_call", name: "shell", call_id: "c1", arguments: '{"command":["bash","-lc","cat note.txt"]}' } },
    { type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: '{"output":"hello\\n","metadata":{"exit_code":0}}' } },
    { type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "c2", input: "*** Begin Patch\n*** Update File: a.txt\n@@\n-old\n+new\n*** End Patch" } },
    { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "c2", output: "Success." } },
    { type: "response_item", payload: { type: "function_call", name: "shell", call_id: "c3", arguments: '{"command":["false"]}' } },
    { type: "response_item", payload: { type: "function_call_output", call_id: "c3", output: '{"output":"","metadata":{"exit_code":1}}' } },
  ].map((r) => JSON.stringify(r));

  it("reads replies and pairs tool calls with their outputs", () => {
    const items = new CodexParser().parse(synthetic);
    expect(items[0]).toMatchObject({ kind: "assistant", text: "Running it." });
    const [shell, patch, failed] = tools(items);
    expect(shell).toMatchObject({ name: "Bash", input: { command: "cat note.txt" }, result: "hello\n", error: false });
    expect(patch).toMatchObject({ name: "apply_patch", result: "Success." });
    expect(patch?.input.patch).toContain("*** Update File: a.txt");
    expect(failed).toMatchObject({ error: true });
  });

  it("fills in an output that arrives in a later read", () => {
    const parser = new CodexParser();
    expect(tools(parser.parse(synthetic.slice(0, 2)))[0]).toMatchObject({ result: null });
    expect(parser.parse(synthetic.slice(2, 3))[0]).toMatchObject({ kind: "tool", result: "hello\n" });
  });
});

describe("AntigravityParser", () => {
  // Real transcripts written by agy (Antigravity CLI) on 2026-10-29: one plain reply, one file read.
  it("reads a plain reply", () => {
    const items = new AntigravityParser().parse(lines("antigravity-ok.jsonl"));
    expect(items).toMatchObject([
      { kind: "user", text: "Reply with the word ok. Do not use tools." },
      { kind: "assistant", text: "ok" },
    ]);
  });

  it("pairs a tool call with the step that holds its result", () => {
    const items = new AntigravityParser().parse(lines("antigravity-read.jsonl"));
    expect(items.map((i) => i.kind)).toEqual(["user", "tool", "assistant"]);
    const [read] = tools(items);
    expect(read).toMatchObject({ name: "Read", input: { file_path: expect.stringContaining("note.txt") }, error: false });
    expect(read?.result).toContain("hello from rigapp test");
  });
});

describe("PiParser", () => {
  // No Pi is installed on this PC. This follows the session format Pi documents and OpenRig and
  // TokenEconomizer's trace/pi.py read (header, then message entries); it checks the code only.
  const entries = [
    { type: "session", id: "s1", cwd: "/home/x" },
    { type: "message", id: "e1", parentId: null, timestamp: "2026-10-29T10:00:00Z", message: { role: "user", content: "list files" } },
    {
      type: "message",
      id: "e2",
      parentId: "e1",
      timestamp: "2026-10-29T10:00:01Z",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "Looking." }, { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }] },
    },
    { type: "message", id: "e3", parentId: "e2", message: { role: "toolResult", toolCallId: "t1", isError: false, content: [{ type: "text", text: "a.txt" }] } },
  ].map((e) => JSON.stringify(e));

  it("reads messages, skips thinking and pairs tool results", () => {
    const items = new PiParser().parse(entries);
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant", "tool"]);
    expect(tools(items)[0]).toMatchObject({ name: "Bash", input: { command: "ls" }, result: "a.txt", error: false });
  });
});

describe("OpenCodeSource", () => {
  // Real session_message rows from OpenCode 2.2.1 (2026-10-29): one session reads a file, the other edits it.
  const sessions = JSON.parse(fixture("opencode-sessions.json")) as Record<
    string,
    { directory: string; rows: { id: string; type: string; seq: number; time_updated: number; data: string }[] }
  >;
  const [readId, editId] = Object.keys(sessions) as [string, string];

  function database(name: string, rowsFor: (id: string) => unknown[] = (id) => sessions[id]!.rows): string {
    const file = join(dir, name);
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT, parent_id TEXT, time_updated INTEGER)");
    db.exec("CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_updated INTEGER, data TEXT)");
    for (const [id, session] of Object.entries(sessions)) {
      db.prepare("INSERT INTO session_v2 VALUES (?, ?, NULL, ?)").run(id, session.directory, session.rows.at(-1)!.time_updated);
      for (const row of rowsFor(id) as typeof session.rows) {
        db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)").run(row.id, id, row.type, row.seq, row.time_updated, row.data);
      }
    }
    db.close();
    return file;
  }

  it("reads a tool call, its output and the reply, and leaves reasoning out", async () => {
    const file = database("read.db");
    const { items } = await new OpenCodeSource(opencodeFile(file, readId)).read();
    expect(items.map((i) => i.kind)).toEqual(["user", "tool", "assistant"]);
    const [read] = tools(items);
    expect(read).toMatchObject({ name: "Read", input: { file_path: expect.stringContaining("note.txt") }, error: false });
    expect(read?.result).toContain("hello from rigapp test");
  });

  it("turns an edit into the Edit shape the diff view reads", async () => {
    const file = database("edit.db");
    const { items } = await new OpenCodeSource(opencodeFile(file, editId)).read();
    expect(tools(items).find((t) => t.name === "Edit")).toMatchObject({ input: { old_string: "hello", new_string: "goodbye" } });
    expect(items.at(-1)).toMatchObject({ kind: "assistant", text: "Done." });
  });

  it("reads a copy when the database sits on a network path", async () => {
    const file = database("copy.db");
    const { items } = await new OpenCodeSource(opencodeFile(file, editId), true).read();
    expect(items.some((i) => i.kind === "assistant")).toBe(true);
  });

  it("picks up rows that arrive later and the newest session for a folder", async () => {
    const early = database("early.db", (id) => sessions[id]!.rows.slice(0, 1));
    const source = new OpenCodeSource(opencodeFile(early, editId));
    expect((await source.read()).items.map((i) => i.kind)).toEqual(["user"]);
    const db = new DatabaseSync(early);
    for (const row of sessions[editId]!.rows.slice(1)) {
      db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)").run(row.id, editId, row.type, row.seq, row.time_updated, row.data);
    }
    db.close();
    expect((await source.read()).items.map((i) => i.kind)).toContain("assistant");
    expect(await source.newestSession("e:\\repos\\ai tools\\rigapp\\test-results\\harness-opencode", sameDir)).toBe(editId);
    expect(await source.newestSession("/nowhere", sameDir)).toBeNull();
  });
});

describe("Thread with other harnesses", () => {
  it("follows an Antigravity transcript as it grows", async () => {
    const all = lines("antigravity-read.jsonl");
    const file = join(dir, "agy.jsonl");
    writeFileSync(file, all.slice(0, 2).join("\n") + "\n");
    thread = new Thread("agy@rig", file, "antigravity");
    await thread.ready;
    const update = new Promise<ServerMessage>((resolve) => thread!.listeners.add(resolve));
    appendFileSync(file, all.slice(2).join("\n") + "\n");
    const message = await update;
    expect(message.type === "thread" && message.items.map((i) => i.kind)).toEqual(["tool", "assistant"]);
  });
});
