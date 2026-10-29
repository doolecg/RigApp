import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatItem } from "@rigapp/contracts";
import { Changes, clip, normalizeTool, parseJson, str, type ToolItem } from "./common.ts";
import type { Source } from "./source.ts";

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" ? (value as Obj) : {});

export interface MessageRow {
  id: string;
  type: string;
  data: string;
}

/**
 * Turns OpenCode 2.x `session_message` rows into chat items. A `user` row holds the prompt
 * (`data.text`); an `assistant` row holds `content` blocks: `text`, `reasoning` (left out) and
 * `tool` blocks that carry their own `state` (`status`, `input`, `content` output), so no
 * separate result row exists. `idle` rows and others are bookkeeping.
 */
export class OpenCodeParser {
  /** Rows can change while the model streams, so the same row may come again: items are replaced by id. */
  parse(rows: MessageRow[]): ChatItem[] {
    const changed = new Changes();
    for (const row of rows) {
      const data = parseJson(row.data);
      if (!data) continue;
      const at = typeof obj(data.time).created === "number" ? new Date(obj(data.time).created as number).toISOString() : null;
      if (row.type === "user") {
        const text = str(data.text) ?? "";
        if (text.trim()) changed.put({ kind: "user", id: row.id, at, text });
      } else if (row.type === "assistant" && Array.isArray(data.content)) {
        data.content.forEach((raw, i) => {
          const block = obj(raw);
          if (block.type === "text" && str(block.text)?.trim()) {
            changed.put({ kind: "assistant", id: `${row.id}:${i}`, at, text: str(block.text)! });
          } else if (block.type === "tool" && str(block.id)) {
            changed.put(this.tool(block, at));
          }
        });
      }
    }
    return changed.items();
  }

  private tool(block: Obj, at: string | null): ToolItem {
    const state = obj(block.state);
    const status = str(state.status);
    const done = status === "completed" || status === "error";
    const output = status === "error" ? (str(state.error) ?? JSON.stringify(state.error ?? "")) : textOf(state.content);
    return {
      kind: "tool",
      id: str(block.id)!,
      at,
      ...normalizeTool(str(block.name) ?? "tool", obj(state.input)),
      result: done ? clip(output) : null,
      error: status === "error",
    };
  }
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return str(content) ?? "";
  return content.map((part) => str(obj(part).text) ?? "").join("\n");
}

/** `<database>#<session id>` is how a thread names an OpenCode conversation. */
export function opencodeFile(database: string, sessionId: string): string {
  return `${database}#${sessionId}`;
}

type Database = import("node:sqlite").DatabaseSync;

/**
 * Reads one OpenCode conversation from its SQLite database (`~/.local/share/opencode/opencode.db`),
 * read-only. A database on this machine is opened in place. One reached through \\wsl.localhost
 * cannot use SQLite's WAL locking, so the database and its WAL are copied to a temp folder when they
 * change, and the copy is read.
 */
export class OpenCodeSource implements Source {
  private parser = new OpenCodeParser();
  private since = 0;
  private signature = "";
  private readonly database: string;
  private readonly sessionId: string;
  private readonly copy: boolean;

  constructor(file: string, copy = file.startsWith("\\\\")) {
    this.copy = copy;
    const at = file.lastIndexOf("#");
    this.database = file.slice(0, at);
    this.sessionId = file.slice(at + 1);
  }

  async read(): Promise<{ reset: boolean; items: ChatItem[] }> {
    return this.withDatabase((db) => {
      // Rows touched since the last read; the newest time is kept, and equal times are read again.
      const rows = db
        .prepare("SELECT id, type, data, time_updated FROM session_message WHERE session_id = ? AND time_updated >= ? ORDER BY seq")
        .all(this.sessionId, this.since) as unknown as (MessageRow & { time_updated: number })[];
      for (const row of rows) this.since = Math.max(this.since, row.time_updated);
      return { reset: false, items: this.parser.parse(rows) };
    });
  }

  /** The id of the newest top-level session started in `cwd`, or null. */
  newestSession(cwd: string, sameDir: (a: string, b: string) => boolean): Promise<string | null> {
    return this.withDatabase((db) => {
      const rows = db.prepare("SELECT id, directory FROM session_v2 WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 100").all() as unknown as {
        id: string;
        directory: string;
      }[];
      return rows.find((row) => sameDir(row.directory, cwd))?.id ?? null;
    });
  }

  private async withDatabase<T>(use: (db: Database) => T): Promise<T> {
    const db = await this.open();
    try {
      return use(db);
    } finally {
      db.close();
    }
  }

  private async open(): Promise<Database> {
    const { DatabaseSync } = await import("node:sqlite");
    if (!this.copy) return new DatabaseSync(this.database, { readOnly: true });
    const [db, wal] = await Promise.all([stat(this.database), stat(`${this.database}-wal`).catch(() => null)]);
    const dir = join(tmpdir(), "rigapp-opencode");
    const target = join(dir, `${Buffer.from(this.database).toString("hex").slice(-24)}.db`);
    const signature = `${db.mtimeMs}:${db.size}:${wal?.mtimeMs}:${wal?.size}`;
    if (signature !== this.signature) {
      await mkdir(dir, { recursive: true });
      await copyFile(this.database, target);
      if (wal) await copyFile(`${this.database}-wal`, `${target}-wal`);
      else await rm(`${target}-wal`, { force: true });
      this.signature = signature;
    }
    return new DatabaseSync(target);
  }
}
