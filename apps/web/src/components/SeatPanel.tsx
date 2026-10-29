import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Project, Seat } from "@rigapp/contracts";
import { seatState, title } from "@/lib/seat";
import { Button } from "./ui/button";
import { StatusDot } from "./StatusDot";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink3">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{children}</dd>
    </>
  );
}

export function SeatPanel({ project, seat }: { project: Project; seat: Seat }) {
  const state = seatState(seat);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(seat.attachCommand ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <aside className="min-h-0 overflow-y-auto bg-g1 px-5 py-4">
      <h2 className="mb-2 text-xs font-normal text-ink3">Seat</h2>
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
        <Row label="Session">
          <span className="font-mono text-xs">{seat.session}</span>
        </Row>
        <Row label="Harness">{seat.harness}</Row>
        <Row label="Pod">{title(seat.pod)}</Row>
        <Row label="Status">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone={state.tone} />
            {state.label}
          </span>
        </Row>
        {seat.error && <Row label="Error">{seat.error}</Row>}
        <Row label="Startup">{seat.startup}</Row>
        {seat.contextPercent != null && <Row label="Context">{seat.contextPercent}% used</Row>}
        {seat.restorePolicy && <Row label="Restore">{seat.restorePolicy}</Row>}
        {seat.agentRef && (
          <Row label="Agent">
            <span className="font-mono text-xs">{seat.agentRef}</span>
          </Row>
        )}
        {seat.cwd && (
          <Row label="Folder">
            <span className="font-mono text-xs">{seat.cwd}</span>
          </Row>
        )}
      </dl>
      <h2 className="mt-6 mb-2 text-xs font-normal text-ink3">Rig</h2>
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5">
        <Row label="Status">{project.status}</Row>
        {project.uptime && <Row label="Uptime">{project.uptime}</Row>}
        {project.latestSnapshot && <Row label="Snapshot">{project.latestSnapshot}</Row>}
      </dl>
      {seat.attachCommand && (
        <Button variant="ghost" className="mt-5 -ml-2" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy attach command"}
        </Button>
      )}
    </aside>
  );
}
