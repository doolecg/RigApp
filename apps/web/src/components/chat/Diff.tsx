import { cn } from "@/lib/utils";

export interface DiffLine {
  /** A space marks an unchanged line kept for context. */
  sign: "+" | "-" | " ";
  text: string;
}

// Long new files would swamp the chat; the rest stays in the session file.
const MAX_LINES = 120;

/**
 * The lines an Edit, MultiEdit or Write call changed, or null for other tools.
 * Lines the old and new text share at the start and end show as context; what
 * is between shows as removed then added. The harness records no line numbers.
 */
export function diffLines(name: string, input: Record<string, unknown>): DiffLine[] | null {
  const split = (text: unknown) => (typeof text === "string" && text.length ? text.split("\n") : []);
  const pair = (from: unknown, to: unknown): DiffLine[] => {
    const old = split(from);
    const now = split(to);
    let head = 0;
    while (head < old.length && head < now.length && old[head] === now[head]) head++;
    let tail = 0;
    while (tail < old.length - head && tail < now.length - head && old.at(-1 - tail) === now.at(-1 - tail)) tail++;
    const context = (lines: string[]) => lines.map((text) => ({ sign: " " as const, text }));
    return [
      ...context(old.slice(0, head)),
      ...old.slice(head, old.length - tail).map((text) => ({ sign: "-" as const, text })),
      ...now.slice(head, now.length - tail).map((text) => ({ sign: "+" as const, text })),
      ...context(old.slice(old.length - tail)),
    ];
  };
  if (name === "Edit") return pair(input.old_string, input.new_string);
  if (name === "MultiEdit" && Array.isArray(input.edits)) {
    return input.edits.flatMap((edit: Record<string, unknown>) => pair(edit.old_string, edit.new_string));
  }
  if (name === "Write") return pair("", input.content);
  return null;
}

export function diffCounts(lines: DiffLine[]) {
  return {
    added: lines.filter((l) => l.sign === "+").length,
    removed: lines.filter((l) => l.sign === "-").length,
  };
}

export function Diff({ lines }: { lines: DiffLine[] }) {
  const shown = lines.slice(0, MAX_LINES);
  return (
    <div className="overflow-x-auto bg-g0 py-1 font-mono text-xs leading-5">
      {shown.map((line, i) => (
        <div
          key={i}
          className={cn(
            "flex min-w-max gap-3 px-3 whitespace-pre",
            line.sign === "+" && "bg-[var(--add)] text-[var(--add-ink)]",
            line.sign === "-" && "bg-[var(--del)] text-[var(--del-ink)]",
            line.sign === " " && "text-ink2",
          )}
        >
          <span aria-hidden>{line.sign === "-" ? "−" : line.sign}</span>
          <span>{line.text || " "}</span>
        </div>
      ))}
      {lines.length > MAX_LINES && <div className="px-3 pt-1 text-ink3">{lines.length - MAX_LINES} more lines</div>}
    </div>
  );
}
