import { Command } from "cmdk";
import { Check, LayoutGrid, PanelLeft, PanelRight, RefreshCw, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Shell } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { seatState } from "@/lib/seat";
import { StatusDot } from "./StatusDot";

export interface PaletteActions {
  openSeat: (session: string) => void;
  openOverview: () => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
}

function Item({ value, onSelect, children }: { value: string; onSelect: () => void; children: ReactNode }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 data-[selected=true]:bg-g3 [&_svg]:size-3.5 [&_svg]:text-ink2"
    >
      {children}
    </Command.Item>
  );
}

const heading = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink3";

/** Ctrl+K: every seat and every action RigApp has, by typing a few letters. */
export function Palette({
  shell,
  open,
  onOpenChange,
  actions,
}: {
  shell: Shell;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteActions;
}) {
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const key = (session: string, name: "approve" | "deny" | "stop") =>
    run(() => void request({ method: "seat.key", session, key: name }));
  const seats = shell.projects.flatMap((project) => project.pods.flatMap((pod) => pod.seats.map((seat) => ({ project, seat }))));
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-black/40"
      contentClassName="fixed top-[12vh] left-1/2 z-50 w-[min(600px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl bg-g2"
    >
      <Command.Input
        placeholder="Type a seat or an action"
        className="w-full bg-transparent px-4 py-3.5 text-sm text-ink outline-none placeholder:text-ink3"
      />
      <Command.List className="max-h-[60vh] overflow-y-auto px-1.5 pb-1.5">
        <Command.Empty className="px-4 py-6 text-center text-ink2">Nothing matches.</Command.Empty>
        <Command.Group heading="Waiting and working" className={heading}>
          {seats
            .filter(({ seat }) => seat.activity === "needs_input")
            .flatMap(({ seat }) => [
              <Item key={`a-${seat.session}`} value={`approve ${seat.logicalId}`} onSelect={() => key(seat.session, "approve")}>
                <Check />
                Approve {seat.logicalId}
              </Item>,
              <Item key={`d-${seat.session}`} value={`deny ${seat.logicalId}`} onSelect={() => key(seat.session, "deny")}>
                <X />
                Deny {seat.logicalId}
              </Item>,
            ])}
          {seats
            .filter(({ seat }) => seat.kind === "agent" && seat.activity === "running")
            .map(({ seat }) => (
              <Item key={`s-${seat.session}`} value={`stop ${seat.logicalId}`} onSelect={() => key(seat.session, "stop")}>
                <Square />
                Stop {seat.logicalId}
              </Item>
            ))}
        </Command.Group>
        <Command.Group heading="Seats" className={heading}>
          {seats.map(({ project, seat }) => (
            <Item
              key={seat.session}
              value={`${seat.logicalId} ${project.name} ${seat.harness}`}
              onSelect={() => run(() => actions.openSeat(seat.session))}
            >
              <StatusDot tone={seatState(seat).tone} />
              {seat.logicalId}
              <span className="text-ink3">· {project.name}</span>
              <span className="ml-auto text-xs text-ink3">{seat.harness}</span>
            </Item>
          ))}
        </Command.Group>
        <Command.Group heading="RigApp" className={heading}>
          <Item value="overview what needs you" onSelect={() => run(actions.openOverview)}>
            <LayoutGrid />
            Open Overview
          </Item>
          <Item value="toggle sidebar" onSelect={() => run(actions.toggleSidebar)}>
            <PanelLeft />
            Show or hide the sidebar
          </Item>
          <Item value="toggle details panel" onSelect={() => run(actions.togglePanel)}>
            <PanelRight />
            Show or hide seat details
          </Item>
          <Item value="check openrig again reconnect" onSelect={() => run(() => void request({ method: "setup.recheck" }))}>
            <RefreshCw />
            Check OpenRig again
          </Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
