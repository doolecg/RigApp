import { ChevronDown, ChevronRight, FilePen, FileText, Search, Terminal, Wrench, X } from "lucide-react";
import { useState } from "react";
import type { ChatItem } from "@rigapp/contracts";
import { Diff, diffCounts, diffLines } from "./Diff";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

const ICONS: Record<string, typeof Wrench> = {
  Bash: Terminal,
  Edit: FilePen,
  MultiEdit: FilePen,
  Write: FilePen,
  Read: FileText,
  Grep: Search,
  Glob: Search,
};

/** The one line that says what the call did: its command, file, pattern or description. */
function summary(input: Record<string, unknown>): string {
  for (const key of ["command", "file_path", "path", "pattern", "query", "url", "description", "prompt"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0]!;
  }
  return "";
}

export function ToolCard({ item }: { item: ToolItem }) {
  const diff = diffLines(item.name, item.input);
  // Edits show their change straight away, as in the mockup; other calls start folded.
  const [open, setOpen] = useState(item.name === "Edit" || item.name === "MultiEdit");
  const Icon = ICONS[item.name] ?? Wrench;
  const Chevron = open ? ChevronDown : ChevronRight;
  const counts = diff && diffCounts(diff);
  const { command: _, ...rest } = item.input;
  return (
    <div className="overflow-hidden rounded-lg bg-g2">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-g3"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Chevron className="size-3.5 shrink-0 text-ink3" />
        <Icon className="size-3.5 shrink-0 text-ink2" />
        <span className="shrink-0 font-semibold">{item.name}</span>
        <span className="min-w-0 truncate font-mono text-xs text-ink2">{summary(item.input)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
          {counts && (
            <span className="font-mono">
              <span className="text-[var(--add-ink)]">+{counts.added}</span>{" "}
              <span className="text-[var(--del-ink)]">−{counts.removed}</span>
            </span>
          )}
          {item.error && (
            <span className="inline-flex items-center gap-1 text-err">
              <X className="size-3" />
              failed
            </span>
          )}
          {item.result === null && <span className="text-ink3">running</span>}
        </span>
      </button>
      {open &&
        (diff ? (
          <Diff lines={diff} />
        ) : (
          <div className="space-y-2 bg-g0 px-3 py-2">
            {typeof item.input.command === "string" ? (
              <pre className="m-0 font-mono text-xs whitespace-pre-wrap text-ink">{item.input.command}</pre>
            ) : null}
            {Object.keys(rest).length > 0 && (
              <pre className="m-0 font-mono text-xs whitespace-pre-wrap text-ink2">{JSON.stringify(rest, null, 2)}</pre>
            )}
            {item.result && (
              <pre className="m-0 max-h-80 overflow-auto font-mono text-xs whitespace-pre-wrap text-ink2">
                {item.result}
              </pre>
            )}
          </div>
        ))}
    </div>
  );
}
