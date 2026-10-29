import { Check, Square } from "lucide-react";
import { useState } from "react";
import type { Shell } from "@rigapp/contracts";
import { ago, entries, GROUPS, needsYou, question, type Entry } from "@/lib/attention";
import { request } from "@/lib/connection";
import { useSeen } from "@/lib/seen";
import { cn } from "@/lib/utils";
import { StatusDot } from "./StatusDot";
import { Button } from "./ui/button";

function detail(entry: Entry): string {
  const { seat, project, group } = entry;
  if (group === "waiting") return question(seat);
  if (group === "errored") return seat.error ?? "Startup failed.";
  if (group === "finished") return "Finished since you last looked.";
  if (group === "working") return "Working";
  if (seat.runtime === "terminal") return "Terminal seat";
  if (seat.status !== "running") return project.status === "stopped" ? "Stopped with the rig" : "Stopped";
  return "Idle";
}

function Row({ entry, onOpen }: { entry: Entry; onOpen: (session: string) => void }) {
  const { seat, project, group } = entry;
  const [busy, setBusy] = useState(false);
  const press = async (key: "approve" | "stop") => {
    setBusy(true);
    await request({ method: "seat.key", session: seat.session, key });
    setBusy(false);
  };
  const tone = GROUPS.find((g) => g.id === group)!.tone;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-g2 px-4 py-2.5">
      <span className="flex min-w-48 items-center gap-2">
        <StatusDot tone={tone} />
        <span className="font-semibold">{seat.logicalId}</span>
        <span className="text-ink3">· {project.name}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-ink2">{detail(entry)}</span>
      <span className="text-xs text-ink3">{ago(seat.lastActivityAt)}</span>
      <span className="flex items-center gap-1">
        {group === "waiting" && (
          <Button className="h-7" disabled={busy} onClick={() => press("approve")}>
            <Check />
            Approve
          </Button>
        )}
        {group === "working" && (
          <Button variant="ghost" className="h-7" disabled={busy} onClick={() => press("stop")}>
            <Square className="fill-current" />
            Stop
          </Button>
        )}
        <Button variant="ghost" className="h-7" onClick={() => onOpen(seat.session)}>
          Open
        </Button>
      </span>
    </li>
  );
}

/** Every seat by what it needs from you, across all projects. */
export function Overview({ shell, onOpen }: { shell: Shell; onOpen: (session: string) => void }) {
  const [only, setOnly] = useState<string | null>(null);
  const all = entries(shell, useSeen());
  const list = all.filter((e) => !only || e.project.id === only);
  const count = needsYou(all);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[920px] px-4 py-8 sm:px-8">
        <h1 className="m-0 text-xl font-semibold">What needs you</h1>
        <p className="mt-1 text-ink2">
          {count === 0
            ? "Nothing needs you right now."
            : `${count} ${count === 1 ? "seat needs" : "seats need"} you across ${shell.projects.length} ${shell.projects.length === 1 ? "project" : "projects"}.`}
        </p>
        <div className="mt-5 flex flex-wrap gap-1" role="tablist">
          {[{ id: null, name: "All projects" }, ...shell.projects].map((p) => (
            <button
              key={p.id ?? "all"}
              role="tab"
              aria-selected={only === p.id}
              className={cn("rounded-md px-2.5 py-1 text-ink2 hover:text-ink", only === p.id && "bg-g3 text-ink")}
              onClick={() => setOnly(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        {GROUPS.map((group) => {
          const rows = list.filter((e) => e.group === group.id);
          if (group.id === "idle" && rows.length === 0) return null;
          return (
            <section key={group.id} className="mt-7">
              <h2 className="m-0 mb-2.5 flex items-center gap-2 text-sm font-semibold">
                <StatusDot tone={group.tone} />
                {group.title}
                <span className="font-normal text-ink3">{rows.length}</span>
              </h2>
              {rows.length ? (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {rows.map((entry) => (
                    <Row key={entry.seat.session} entry={entry} onOpen={onOpen} />
                  ))}
                </ul>
              ) : (
                <p className="m-0 pl-4 text-ink3">{group.empty}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
