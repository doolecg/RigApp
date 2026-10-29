import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import type { ChatItem } from "@rigapp/contracts";
import { AntigravityParser } from "./antigravity.ts";
import { ClaudeParser } from "./claude.ts";
import { CodexParser } from "./codex.ts";
import type { LineParser } from "./common.ts";
import { OpenCodeSource } from "./opencode.ts";
import { PiParser } from "./pi.ts";

/** Which harness wrote the session, and so how to read it. */
export type ChatFormat = "claude" | "codex" | "pi" | "antigravity" | "opencode";

/** Reads whatever a harness wrote since the last call. Read-only. */
export interface Source {
  /** The items added or changed. `reset` means the session was replaced: the old items are void. */
  read(): Promise<{ reset: boolean; items: ChatItem[] }>;
}

const PARSERS: Record<Exclude<ChatFormat, "opencode">, () => LineParser> = {
  claude: () => new ClaudeParser(),
  codex: () => new CodexParser(),
  pi: () => new PiParser(),
  antigravity: () => new AntigravityParser(),
};

/** Follows a JSONL session file, parsing only the lines added since the last read. */
class JsonlSource implements Source {
  private parser: LineParser;
  private decoder = new StringDecoder("utf8");
  private offset = 0;
  private rest = "";

  private readonly file: string;
  private readonly make: () => LineParser;

  constructor(file: string, make: () => LineParser) {
    this.file = file;
    this.make = make;
    this.parser = make();
  }

  async read(): Promise<{ reset: boolean; items: ChatItem[] }> {
    const { size } = await stat(this.file);
    // The file got shorter, so it was replaced: read it again from the top.
    const reset = size < this.offset;
    if (reset) {
      this.parser = this.make();
      this.decoder = new StringDecoder("utf8");
      this.offset = 0;
      this.rest = "";
    }
    if (size === this.offset) return { reset, items: [] };
    const handle = await open(this.file, "r");
    const buffer = Buffer.alloc(size - this.offset);
    try {
      await handle.read(buffer, 0, buffer.length, this.offset);
    } finally {
      await handle.close();
    }
    this.offset = size;
    // Keep any half-written last line for the next read.
    const lines = (this.rest + this.decoder.write(buffer)).split("\n");
    this.rest = lines.pop() ?? "";
    return { reset, items: this.parser.parse(lines) };
  }
}

export function openSource(format: ChatFormat, file: string): Source {
  return format === "opencode" ? new OpenCodeSource(file) : new JsonlSource(file, PARSERS[format]);
}
