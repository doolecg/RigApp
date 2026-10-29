import type { ChatItem } from "@rigapp/contracts";
import { Changes, clip, normalizeTool, parseJson, str, type LineParser, type ToolItem } from "./common.ts";

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" ? (value as Obj) : {});

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (obj(block).type === "text" ? (str(obj(block).text) ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * Turns Pi session lines (`<sessions folder>/<time>_<id>.jsonl`) into chat items. Entries form a
 * tree (`id`, `parentId`); this reads them in file order, so a branch the user abandoned still
 * shows. Messages carry `role` user, assistant (text, `thinking` and `toolCall` blocks) or
 * `toolResult` (with `toolCallId` and `isError`). Thinking and non-message entries are left out.
 */
export class PiParser implements LineParser {
  private tools = new Map<string, ToolItem>();

  parse(lines: string[]): ChatItem[] {
    const changed = new Changes();
    for (const line of lines) {
      const entry = parseJson(line);
      if (!entry || entry.type !== "message") continue;
      const id = str(entry.id);
      const message = obj(entry.message);
      const at = str(entry.timestamp) ?? null;
      if (!id) continue;
      if (message.role === "user") {
        const text = textOf(message.content);
        if (text.trim()) changed.put({ kind: "user", id, at, text });
      } else if (message.role === "assistant" && Array.isArray(message.content)) {
        message.content.forEach((raw, i) => {
          const block = obj(raw);
          if (block.type === "text" && str(block.text)?.trim()) {
            changed.put({ kind: "assistant", id: `${id}:${i}`, at, text: str(block.text)! });
          } else if (block.type === "toolCall" && str(block.id)) {
            const tool: ToolItem = {
              kind: "tool",
              id: str(block.id)!,
              at,
              ...normalizeTool(str(block.name) ?? "tool", obj(block.arguments)),
              result: null,
              error: false,
            };
            this.tools.set(tool.id, tool);
            changed.put(tool);
          }
        });
      } else if (message.role === "toolResult") {
        const tool = this.tools.get(str(message.toolCallId) ?? "");
        if (!tool) continue;
        tool.result = clip(textOf(message.content));
        tool.error = message.isError === true;
        changed.put(tool);
      }
    }
    return changed.items();
  }
}
