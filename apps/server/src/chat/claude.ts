import type { ChatItem } from "@rigapp/contracts";
import { clip, type LineParser, type ToolItem } from "./common.ts";

interface Block {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface Entry {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { content?: string | Block[] };
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: Block) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`)).join("\n");
}

/**
 * Turns Claude Code session lines (`~/.claude/projects/<cwd>/<id>.jsonl`) into chat items.
 * It remembers tool calls so a later result line can fill one in. Thinking, sub-agent
 * (sidechain) and bookkeeping lines are left out.
 */
export class ClaudeParser implements LineParser {
  private tools = new Map<string, ToolItem>();

  /** Returns the items these lines added or changed, in order. */
  parse(lines: string[]): ChatItem[] {
    const changed = new Map<string, ChatItem>();
    const put = (item: ChatItem) => {
      changed.delete(item.id);
      changed.set(item.id, item);
    };
    for (const line of lines) {
      let entry: Entry;
      try {
        entry = JSON.parse(line) as Entry;
      } catch {
        continue;
      }
      if (entry.isSidechain || entry.isMeta || !entry.uuid) continue;
      if (entry.type !== "user" && entry.type !== "assistant") continue;
      const kind = entry.type;
      const at = entry.timestamp ?? null;
      const content = entry.message?.content;
      if (typeof content === "string") {
        if (content.trim()) put({ kind, id: entry.uuid, at, text: content });
        continue;
      }
      content?.forEach((block, i) => {
        if (block.type === "text" && block.text?.trim()) {
          put({ kind, id: `${entry.uuid}:${i}`, at, text: block.text });
        } else if (block.type === "tool_use" && block.id) {
          const item: ToolItem = {
            kind: "tool",
            id: block.id,
            at,
            name: block.name ?? "tool",
            input: block.input ?? {},
            result: null,
            error: false,
          };
          this.tools.set(block.id, item);
          put(item);
        } else if (block.type === "tool_result" && block.tool_use_id) {
          const item = this.tools.get(block.tool_use_id);
          if (!item) return;
          item.result = clip(resultText(block.content));
          item.error = !!block.is_error;
          put(item);
        }
      });
    }
    return [...changed.values()];
  }
}
