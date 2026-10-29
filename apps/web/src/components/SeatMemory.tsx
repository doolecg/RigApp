import { useEffect, useState } from "react";
import type { Project } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { title } from "@/lib/seat";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";

export interface SeatToolState {
  mcptoon: string | null;
  hindsight: boolean;
  codegraph: string | null;
}

/** What WSL has for seats; asked once and shared by the Memory and Code tabs. */
let checked: Promise<SeatToolState | null> | null = null;
function useSeatTools(): SeatToolState | null {
  const [state, setState] = useState<SeatToolState | null>(null);
  useEffect(() => {
    checked ??= request({ method: "tools.seatTools" }).then((r) => (r.ok ? (r.data as SeatToolState) : null));
    void checked.then(setState);
  }, []);
  return state;
}

/**
 * Sends a pod's running seats one short note on how to use a tool from Bash, so the
 * tool costs them nothing per turn (an MCP tool list would sit in every turn).
 */
function SeatNote({ project, heading, ready, missing, cost, note }: {
  project: Project;
  heading: string;
  ready: boolean | null;
  missing: string;
  cost: string;
  note: string;
}) {
  const [pod, setPod] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const seatsOf = (name: string) =>
    project.pods.find((p) => p.name === name)?.seats.filter((s) => s.kind === "agent" && s.status === "running") ?? [];

  const send = async () => {
    if (!pod) return;
    const seats = seatsOf(pod);
    const results = await Promise.all(seats.map((s) => request({ method: "seat.send", session: s.session, text: note })));
    const failed = results.filter((r) => !r.ok);
    setSent(failed.length ? `Not sent to ${failed.length} seat(s): ${failed[0]!.error}` : `Sent to ${seats.length} seat(s) in ${title(pod)}.`);
    setPod(null);
  };

  return (
    <div className="mt-6">
      <h2 className="mt-0 mb-2 text-xs font-normal text-ink3">{heading}</h2>
      {ready === null ? (
        <p className="m-0 text-ink3">Checking WSL</p>
      ) : !ready ? (
        <p className="m-0 text-xs text-ink2">{missing}</p>
      ) : (
        <>
          <p className="mt-0 text-xs text-ink2">{cost}</p>
          <div className="flex flex-wrap gap-1.5">
            {project.pods.map((p) => (
              <Button key={p.name} variant="ghost" className="h-7 bg-g2" disabled={seatsOf(p.name).length === 0} onClick={() => setPod(p.name)}>
                Tell {title(p.name)}
              </Button>
            ))}
          </div>
          {sent && <p className="mt-2 mb-0 text-xs text-ink2">{sent}</p>}
        </>
      )}
      {pod && (
        <Modal title={`Send ${title(pod)} this note?`} onClose={() => setPod(null)}>
          <p className="mt-0 text-ink2">
            {seatsOf(pod)
              .map((s) => s.logicalId)
              .join(", ")}{" "}
            will get it once:
          </p>
          <pre className="m-0 mb-3 rounded-md bg-g0 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-ink">{note}</pre>
          <div className="flex gap-2">
            <Button onClick={send}>Send the note</Button>
            <Button variant="ghost" onClick={() => setPod(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Measured on 2026-10-29 with mcptoon 0.8.33 against this PC's Hindsight (39 tools):
// as a normal MCP server its tool list is about 19,856 tokens in every turn of every seat;
// through mcptoon a seat pays nothing per turn and about 540 tokens the first time it calls.
export function SeatMemory({ project, bank }: { project: Project; bank: string }) {
  const state = useSeatTools();
  const q = (tool: string) => `mcptoon call hindsight ${tool} '{"bank_id":"${bank}","query":"<words>"}'`;
  const note = [
    "RigApp note from doole: you can search this project's Hindsight memory from Bash, without MCP tools in your context.",
    `Past decisions and context: ${q("recall")}`,
    `Its knowledge pages: ${q("search_knowledge_base")}`,
    "Only read with these two; do not use other hindsight tools. No reply needed.",
  ].join("\n");
  return (
    <SeatNote
      project={project}
      heading="Give seats this memory"
      ready={state && !!state.mcptoon && state.hindsight && !!bank}
      missing={`Seats use Hindsight through mcptoon, inside WSL. ${!state?.mcptoon ? "mcptoon is not installed there." : "mcptoon has no hindsight server yet."}`}
      cost="As a normal MCP server, Hindsight's tool list costs a seat about 19,900 tokens on every turn. Through mcptoon it costs nothing per turn: the seat gets this short note (about 90 tokens) once and calls Hindsight from Bash when it needs to."
      note={note}
    />
  );
}

/** CodeGraph is a plain CLI, so seats need no MCP server at all: one note and Bash. */
export function SeatCode({ project }: { project: Project }) {
  const state = useSeatTools();
  const note = [
    "RigApp note from doole: CodeGraph has indexed this code. From Bash in your working folder:",
    'codegraph explore "<symbols or a question>"   (source and call paths in one go)',
    'codegraph callers <symbol>   ·   codegraph node <symbol or file>',
    "Use it before reading many files. No reply needed.",
  ].join("\n");
  return (
    <SeatNote
      project={project}
      heading="Give seats CodeGraph"
      ready={state && !!state.codegraph}
      missing="The codegraph command does not run inside WSL, where seats work."
      cost="CodeGraph is a command, not an MCP server, so it adds nothing to a seat's turns. The seat gets this short note (about 70 tokens) once. It works in folders on Windows drives (/mnt/...)."
      note={note}
    />
  );
}
