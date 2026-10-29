import { useEffect, useState } from "react";
import type { Project } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { title } from "@/lib/seat";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";

// Measured on 2026-10-29 with mcptoon 0.8.33 against this PC's Hindsight (39 tools):
// as a normal MCP server its tool list is about 19,856 tokens in every turn of every seat;
// through mcptoon a seat pays nothing per turn and about 540 tokens the first time it calls.
const FULL_TOKENS = "19,900";

/** The note a seat gets: two read-only commands for this project's bank. */
function brief(bank: string): string {
  const q = (tool: string, field: string) => `mcptoon call hindsight ${tool} '{"bank_id":"${bank}","${field}":"<words>"}'`;
  return [
    "RigApp note from doole: you can search this project's Hindsight memory from Bash, without MCP tools in your context.",
    `Past decisions and context: ${q("recall", "query")}`,
    `Its knowledge pages: ${q("search_knowledge_base", "query")}`,
    "Only read with these two; do not use other hindsight tools. No reply needed.",
  ].join("\n");
}

/** Gives chosen pods Hindsight through mcptoon, so their context does not grow on every turn. */
export function SeatMemory({ project, bank }: { project: Project; bank: string }) {
  const [state, setState] = useState<{ mcptoon: string | null; hindsight: boolean } | null>(null);
  const [pod, setPod] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    void request({ method: "tools.seatTools" }).then((r) => r.ok && setState(r.data as { mcptoon: string | null; hindsight: boolean }));
  }, []);

  const seatsOf = (name: string) =>
    project.pods.find((p) => p.name === name)?.seats.filter((s) => s.kind === "agent" && s.status === "running") ?? [];

  const send = async () => {
    if (!pod) return;
    const results = await Promise.all(seatsOf(pod).map((s) => request({ method: "seat.send", session: s.session, text: brief(bank) })));
    const failed = results.filter((r) => !r.ok);
    setSent(failed.length ? `Not sent to ${failed.length} seat(s): ${failed[0]!.error}` : `Sent to ${seatsOf(pod).length} seat(s) in ${title(pod)}.`);
    setPod(null);
  };

  return (
    <div className="mt-6">
      <h2 className="mt-0 mb-2 text-xs font-normal text-ink3">Give seats this memory</h2>
      {!state ? (
        <p className="m-0 text-ink3">Checking for mcptoon</p>
      ) : !state.mcptoon || !state.hindsight ? (
        <p className="m-0 text-xs text-ink2">
          Seats use Hindsight through mcptoon, inside WSL. {!state.mcptoon ? "mcptoon is not installed there." : "mcptoon has no hindsight server yet."}
        </p>
      ) : (
        <>
          <p className="mt-0 text-xs text-ink2">
            As a normal MCP server, Hindsight's tool list costs a seat about {FULL_TOKENS} tokens on every turn. Through mcptoon it costs
            nothing per turn: the seat gets one short note (about 90 tokens) and calls Hindsight from Bash when it needs to.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {project.pods.map((p) => (
              <Button key={p.name} variant="ghost" className="h-7 bg-g2" disabled={!bank || seatsOf(p.name).length === 0} onClick={() => setPod(p.name)}>
                Tell {title(p.name)}
              </Button>
            ))}
          </div>
          {sent && <p className="mt-2 mb-0 text-xs text-ink2">{sent}</p>}
        </>
      )}
      {pod && (
        <Modal title={`Give ${title(pod)} this project's memory?`} onClose={() => setPod(null)}>
          <p className="mt-0 text-ink2">
            {seatsOf(pod)
              .map((s) => s.logicalId)
              .join(", ")}{" "}
            will get this note once:
          </p>
          <pre className="m-0 mb-3 rounded-md bg-g0 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-ink">{brief(bank)}</pre>
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
