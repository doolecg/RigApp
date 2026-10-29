import { ChevronDown, ChevronRight, LayoutGrid, PanelLeft, Plus, Search, Settings } from "lucide-react";
import { useState } from "react";
import type { Project, Shell } from "@rigapp/contracts";
import type { View } from "@/App";
import { entries, needsYou } from "@/lib/attention";
import { seatState, title } from "@/lib/seat";
import { isUnread, useSeen } from "@/lib/seen";
import { useStored } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { NewProject } from "./NewProject";
import { StatusDot } from "./StatusDot";
import { Button } from "./ui/button";

interface Props {
  shell: Shell;
  view: View;
  selected: string | null;
  onSelect: (session: string) => void;
  onOverview: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onHide: () => void;
}

export function Sidebar({ shell, view, selected, onSelect, onOverview, onSearch, onSettings, onHide }: Props) {
  const { daemon } = shell;
  const seen = useSeen();
  const count = needsYou(entries(shell, seen));
  const [creating, setCreating] = useState(false);
  return (
    <aside className="flex h-full min-h-0 flex-col bg-g0">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="grid size-5 place-items-center rounded bg-acc text-[11px] font-bold text-acc-ink">R</span>
          RigApp
          <Button variant="ghost" size="icon" className="-mr-1.5 ml-auto" aria-label="Hide sidebar" onClick={onHide}>
            <PanelLeft />
          </Button>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] whitespace-nowrap text-ink2">
          <StatusDot tone={daemon.ok ? "acc" : "err"} />
          <span className="truncate">
            OpenRig {daemon.version} · {daemon.host} · {daemon.url.replace("http://", "")}
          </span>
        </div>
      </div>
      <div className="px-2">
        <button
          className="mb-2 flex w-full items-center gap-2 rounded-md bg-g2 px-2.5 py-1.5 text-left text-ink3 hover:text-ink2"
          onClick={onSearch}
        >
          <Search className="size-3.5" />
          Search
          <span className="ml-auto font-mono text-[11px]">Ctrl K</span>
        </button>
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-g2",
            view === "overview" && "bg-g3 hover:bg-g3",
          )}
          onClick={onOverview}
        >
          <LayoutGrid className="size-3.5 text-ink2" />
          Overview
          {count > 0 && <span className="ml-auto text-xs text-warn">{count}</span>}
        </button>
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-g2" onClick={() => setCreating(true)}>
          <Plus className="size-3.5 text-ink2" />
          New project
        </button>
        {creating && <NewProject shell={shell} onClose={() => setCreating(false)} />}
      </div>
      <div className="px-4 pt-4 pb-1 text-xs text-ink3">Projects</div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {shell.projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            selected={view === "seat" ? selected : null}
            seen={seen}
            onSelect={onSelect}
          />
        ))}
      </nav>
      <div className="px-2 pb-3">
        <button
          className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-g2", view === "settings" && "bg-g3 hover:bg-g3")}
          onClick={onSettings}
        >
          <Settings className="size-3.5 text-ink2" />
          Settings
          <span className="ml-auto text-xs text-ink3">{shell.version}</span>
        </button>
      </div>
    </aside>
  );
}

function ProjectItem({
  project,
  selected,
  seen,
  onSelect,
}: { project: Project; seen: Record<string, string> } & Pick<Props, "selected" | "onSelect">) {
  const [open, setOpen] = useStored(`rigapp.projectOpen.${project.id}`, true);
  const seatCount = project.pods.reduce((n, pod) => n + pod.seats.length, 0);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="mb-2">
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-g2"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Chevron className="size-3.5 text-ink3" />
        <span className="font-semibold">{project.name}</span>
        <span className="ml-auto text-xs text-ink3">
          {project.status} · {seatCount} {seatCount === 1 ? "seat" : "seats"}
        </span>
      </button>
      {open &&
        project.pods.map((pod) => (
          <div key={pod.name}>
            <div className="px-7 pt-2 pb-0.5 text-xs text-ink3">{title(pod.name)}</div>
            {pod.seats.map((seat) => {
              const state = seatState(seat);
              return (
                <button
                  key={seat.session}
                  onClick={() => onSelect(seat.session)}
                  title={`${seat.logicalId} · ${state.label}`}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-left hover:bg-g2",
                    selected === seat.session && "bg-g3 hover:bg-g3",
                  )}
                >
                  <StatusDot tone={state.tone} />
                  <span>{seat.member}</span>
                  {project.lead === seat.session && <span className="text-xs text-acc">lead</span>}
                  {seat.kind === "agent" && selected !== seat.session && isUnread(seat, seen) && (
                    <span className="size-1.5 rounded-full bg-ink" aria-label="new activity" />
                  )}
                  <span className="ml-auto text-xs text-ink3">{seat.harness}</span>
                </button>
              );
            })}
          </div>
        ))}
    </div>
  );
}
