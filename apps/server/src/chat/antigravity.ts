import type { ChatItem } from "@rigapp/contracts";
import { Changes, clip, normalizeTool, parseJson, str, type LineParser, type ToolItem } from "./common.ts";

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" ? (value as Obj) : {});

/** agy wraps what you typed in <USER_REQUEST> and adds metadata blocks after it. */
function request(content: string): string {
  return /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/.exec(content)?.[1] ?? content;
}

/**
 * Turns Antigravity CLI steps (`~/.gemini/antigravity-cli/brain/<conversation>/.system_generated/logs/transcript_full.jsonl`)
 * into chat items. One step per line: `USER_INPUT` is the prompt; `PLANNER_RESPONSE` is the model,
 * with `content` (its reply) and `tool_calls` (`{name, args}`, no ids). A tool's result is the next
 * step the model's own tool run writes (seen: type `GENERIC`), so results are matched to calls in order.
 */
export class AntigravityParser implements LineParser {
  private pending: ToolItem[] = [];

  parse(lines: string[]): ChatItem[] {
    const changed = new Changes();
    for (const line of lines) {
      const step = parseJson(line);
      if (!step) continue;
      const index = step.step_index;
      const at = str(step.created_at) ?? null;
      const content = str(step.content) ?? "";
      if (step.type === "USER_INPUT") {
        const text = request(content);
        if (text.trim()) changed.put({ kind: "user", id: `s${index}`, at, text });
      } else if (step.type === "PLANNER_RESPONSE") {
        if (content.trim()) changed.put({ kind: "assistant", id: `s${index}`, at, text: content });
        const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
        calls.forEach((raw, i) => {
          const call = obj(raw);
          const tool: ToolItem = {
            kind: "tool",
            id: `s${index}:${i}`,
            at,
            ...normalizeTool(str(call.name) ?? "tool", obj(call.args)),
            result: null,
            error: false,
          };
          this.pending.push(tool);
          changed.put(tool);
        });
      } else if (step.source === "MODEL" && this.pending.length) {
        const tool = this.pending.shift()!;
        tool.result = clip(content);
        tool.error = /ERROR|FAIL/.test(str(step.status) ?? "");
        changed.put(tool);
      }
    }
    return changed.items();
  }
}
