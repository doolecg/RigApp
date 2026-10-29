import type { ChatItem } from "@rigapp/contracts";
import { Changes, clip, normalizeTool, parseJson, str, type LineParser, type ToolItem } from "./common.ts";

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" ? (value as Obj) : {});

/** The text parts of a Codex message: `output_text` and `input_text` blocks, or `{text}` items. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => str(obj(part).text) ?? "").filter(Boolean).join("\n");
}

/** A command as one string. Codex sends argv; `["bash", "-lc", "ls"]` is shown as `ls`. */
function commandText(command: unknown): string {
  if (!Array.isArray(command)) return str(command) ?? "";
  const argv = command.map(String);
  return /^(bash|sh|zsh)$/.test(argv[0] ?? "") && /^-\w*c$/.test(argv[1] ?? "") && argv.length === 3 ? argv[2]! : argv.join(" ");
}

/** A call's output: plain text, or older Codex versions' JSON `{"output": "...", "metadata": {"exit_code": 0}}`. */
function outputText(output: unknown): { text: string; error: boolean } {
  if (typeof output === "string") {
    const json = output.startsWith("{") ? parseJson(output) : null;
    if (json && typeof json.output === "string") {
      const code = obj(json.metadata).exit_code;
      return { text: json.output, error: typeof code === "number" && code !== 0 };
    }
    return { text: output, error: false };
  }
  const inner = obj(output);
  return { text: typeof inner.content === "string" ? inner.content : textOf(inner.content ?? output), error: inner.success === false };
}

/**
 * Turns Codex rollout lines (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`) into chat items.
 * The prompt you typed comes from the `event_msg` record (the `response_item` copy of it sits
 * between Codex's own context messages); the reply from `response_item/message`; tools from
 * `function_call`, `custom_tool_call` (`apply_patch`, code-mode `exec`) and `local_shell_call`,
 * filled in by the `*_output` record with the same call id. Reasoning and bookkeeping are left out.
 */
export class CodexParser implements LineParser {
  private tools = new Map<string, ToolItem>();
  // Records with no id of their own get a number, which stays the same when the file is read again.
  private count = 0;

  parse(lines: string[]): ChatItem[] {
    const changed = new Changes();
    for (const line of lines) {
      const record = parseJson(line);
      if (!record) continue;
      const at = str(record.timestamp) ?? null;
      const payload = obj(record.payload);
      this.count++;
      if (record.type === "event_msg") {
        if (payload.type === "user_message") {
          const text = str(payload.message) ?? "";
          if (text.trim()) changed.put({ kind: "user", id: `u${this.count}`, at, text });
        } else if (payload.type === "item_completed" && obj(payload.item).type === "UserMessage") {
          const item = obj(payload.item);
          const text = textOf(item.content);
          if (text.trim()) changed.put({ kind: "user", id: str(item.id) ?? `u${this.count}`, at, text });
        }
        continue;
      }
      if (record.type !== "response_item") continue;
      switch (payload.type) {
        case "message":
          if (payload.role === "assistant") {
            const text = textOf(payload.content);
            if (text.trim()) changed.put({ kind: "assistant", id: str(payload.id) ?? `a${this.count}`, at, text });
          }
          break;
        case "function_call": {
          const raw = str(payload.arguments) ?? "";
          const args = parseJson(raw) ?? (raw ? { arguments: raw } : {});
          this.call(changed, str(payload.call_id), at, str(payload.name) ?? "tool", args);
          break;
        }
        case "custom_tool_call": {
          const name = str(payload.name) ?? "tool";
          const input = str(payload.input) ?? "";
          this.call(changed, str(payload.call_id), at, name, name === "apply_patch" ? { patch: input } : { code: input });
          break;
        }
        case "local_shell_call":
          this.call(changed, str(payload.call_id) ?? str(payload.id), at, "Bash", { command: commandText(obj(payload.action).command) });
          break;
        case "function_call_output":
        case "custom_tool_call_output": {
          const tool = this.tools.get(str(payload.call_id) ?? "");
          if (!tool) break;
          const { text, error } = outputText(payload.output);
          tool.result = clip(text);
          tool.error = error;
          changed.put(tool);
          break;
        }
      }
    }
    return changed.items();
  }

  private call(changed: Changes, id: string | undefined, at: string | null, name: string, input: Obj): void {
    if (!id) return;
    // Shell tools: `shell` sends argv under `command`, `exec_command` a string under `cmd`.
    if (name === "shell" || name === "shell_command" || name === "exec_command") {
      name = "Bash";
      input = { command: commandText(input.command ?? input.cmd), ...(typeof input.workdir === "string" ? { workdir: input.workdir } : {}) };
    }
    const tool: ToolItem = { kind: "tool", id, at, ...normalizeTool(name, input), result: null, error: false };
    this.tools.set(id, tool);
    changed.put(tool);
  }
}
