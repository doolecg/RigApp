import type { ChatItem } from "@rigapp/contracts";

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** Turns session lines into chat items; every harness has one. */
export interface LineParser {
  /** Returns the items these lines added or changed, in order. */
  parse(lines: string[]): ChatItem[];
}

// Tool output can be huge (whole files, long logs); the chat only needs a look.
const RESULT_LIMIT = 4000;

export function clip(text: string): string {
  return text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}\n… ${text.length - RESULT_LIMIT} more characters` : text;
}

/** Collects the items a parser touched while reading a batch, keeping the last version of each. */
export class Changes {
  private map = new Map<string, ChatItem>();

  put(item: ChatItem): void {
    this.map.delete(item.id);
    this.map.set(item.id, item);
  }

  items(): ChatItem[] {
    return [...this.map.values()];
  }
}

export function parseJson(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

// The chat card knows Claude Code's tool names and input keys (icons, the diff view,
// the one-line summary). Other harnesses name the same tools differently; rename the
// ones that match, and leave every other tool as the harness called it.
const TOOLS: Record<string, string> = {
  read: "Read",
  read_file: "Read",
  edit: "Edit",
  write: "Write",
  bash: "Bash",
  grep: "Grep",
  glob: "Glob",
};

const KEYS: Record<string, string> = {
  path: "file_path",
  filePath: "file_path",
  Path: "file_path",
  oldString: "old_string",
  newString: "new_string",
  oldText: "old_string",
  newText: "new_string",
};

export function normalizeTool(name: string, input: Record<string, unknown>): { name: string; input: Record<string, unknown> } {
  const known = TOOLS[name];
  if (!known) return { name, input };
  const renamed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) renamed[KEYS[key] ?? key] = value;
  return { name: known, input: renamed };
}
