import { Camera, History, Play, Power } from "lucide-react";
import { useEffect, useState } from "react";
import type { Project, SnapshotInfo, UsageWindow } from "@rigapp/contracts";
import { ago } from "@/lib/attention";
import { request } from "@/lib/connection";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";

const NOTICE = 'Provided "as is", without warranty, under the MIT licence. To the extent permitted by law, the authors are not liable for any loss from using it.';

interface PlanNode {
  logicalId: string;
  intendedAction?: string;
}

type Ask =
  | { kind: "down" }
  | { kind: "up"; plan: { nodes?: PlanNode[]; snapshot?: { createdAt: string } } | null }
  | { kind: "restore"; snapshot: SnapshotInfo };

function utc(sqlTime: string) {
  // The daemon stores "YYYY-MM-DD HH:MM:SS" in UTC.
  return new Date(`${sqlTime.replace(" ", "T")}Z`).toISOString();
}

function Bar({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-ink2">{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-g3">
        <div className={percent >= 80 ? "h-full bg-warn" : "h-full bg-acc"} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <div className="mt-0.5 text-xs text-ink3">{detail}</div>
    </div>
  );
}

/** The rig's life: up and down, snapshots with restore, and what it costs. */
export function RigPanel({ project }: { project: Project }) {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[] | null>(null);
  const [usage, setUsage] = useState<UsageWindow[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [keepSnapshot, setKeepSnapshot] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => {
    void request({ method: "rig.snapshots", rigId: project.id }).then((r) => setSnapshots(r.ok ? (r.data as SnapshotInfo[]) : []));
    void request({ method: "usage" }).then((r) => r.ok && setUsage(r.data as UsageWindow[]));
  };
  useEffect(refresh, [project.id, project.latestSnapshot]);

  const run = async (work: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    const r = await work();
    setBusy(false);
    setAsk(null);
    setMessage(r.ok ? done : (r.error ?? "That did not work."));
    refresh();
  };

  const startUp = async () => {
    setAsk({ kind: "up", plan: null });
    const r = await request({ method: "rig.up", rigId: project.id, plan: true });
    setAsk({ kind: "up", plan: (r.data as { nodes?: PlanNode[] }) ?? {} });
  };

  const running = project.status === "running";
  const seats = project.pods.flatMap((p) => p.seats);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button variant="ghost" className="bg-g3" onClick={() => setAsk({ kind: "down" })}>
            <Power />
            Rig down
          </Button>
        ) : (
          <Button onClick={startUp}>
            <Play />
            Rig up
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => run(() => request({ method: "rig.snapshot", rigId: project.id }), "Snapshot taken.")}>
          <Camera />
          Take snapshot
        </Button>
      </div>
      {message && <p className="mt-2 mb-0 text-xs text-ink2">{message}</p>}

      <h2 className="mt-6 mb-2 text-xs font-normal text-ink3">Usage</h2>
      {usage.map((w) => (
        <Bar
          key={`${w.provider}:${w.window}`}
          label={`${w.provider === "claude" ? "Claude" : w.provider}, ${w.window === "five_hour" ? "5-hour window" : w.window === "weekly" ? "weekly" : w.window}`}
          percent={w.usedPercent}
          detail={`Resets ${new Date(w.resetsAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`}
        />
      ))}
      {seats
        .filter((s) => s.contextPercent != null)
        .map((s) => (
          <Bar key={s.session} label={`${s.logicalId} context`} percent={s.contextPercent!} detail="Share of the seat's context window in use" />
        ))}

      <h2 className="mt-6 mb-2 text-xs font-normal text-ink3">Snapshots</h2>
      {snapshots === null ? (
        <p className="m-0 text-ink3">Loading</p>
      ) : snapshots.length === 0 ? (
        <p className="m-0 text-ink3">No snapshots yet.</p>
      ) : (
        <ol className="m-0 list-none p-0">
          {snapshots.map((s) => (
            <li key={s.id} className="group flex items-center gap-2 rounded-md py-1 pr-1 pl-2 hover:bg-g2">
              <span className="size-1.5 shrink-0 rounded-full bg-ink3" aria-hidden />
              <span>{ago(utc(s.createdAt))} ago</span>
              <span className="text-xs text-ink3">{s.kind.replace("auto-", "auto ")}</span>
              <Button
                variant="ghost"
                className="ml-auto h-6 px-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                disabled={s.status !== "complete"}
                onClick={() => setAsk({ kind: "restore", snapshot: s })}
              >
                <History />
                Restore
              </Button>
            </li>
          ))}
        </ol>
      )}

      {ask?.kind === "down" && (
        <Modal title={`Stop ${project.name}?`} onClose={() => setAsk(null)}>
          <p className="mt-0 text-ink2">All {seats.length} seats stop. Their work is kept and Rig up can bring them back.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={keepSnapshot} onChange={(e) => setKeepSnapshot(e.target.checked)} />
            Take a snapshot first
          </label>
          <p className="text-xs text-ink3">{NOTICE}</p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => run(() => request({ method: "rig.down", rigId: project.id, snapshot: keepSnapshot }), `${project.name} is stopping.`)}>
              Rig down
            </Button>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
      {ask?.kind === "up" && (
        <Modal title={`Start ${project.name}?`} onClose={() => setAsk(null)}>
          {ask.plan === null ? (
            <p className="m-0 text-ink2">Asking OpenRig what would happen</p>
          ) : (
            <>
              <p className="mt-0 text-ink2">
                OpenRig's plan{ask.plan.snapshot ? `, from the snapshot of ${ask.plan.snapshot.createdAt} UTC` : ""}:
              </p>
              <ul className="mt-0 pl-5">
                {(ask.plan.nodes ?? []).map((n) => (
                  <li key={n.logicalId}>
                    {n.logicalId}: {n.intendedAction?.replaceAll("-", " ") ?? "start"}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink3">Claude Code and Codex seats spend tokens once they start. {NOTICE}</p>
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => run(() => request({ method: "rig.up", rigId: project.id, plan: false }), `${project.name} is starting.`)}>
                  Rig up
                </Button>
                <Button variant="ghost" onClick={() => setAsk(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
      {ask?.kind === "restore" && (
        <Modal title={`Restore ${project.name}?`} onClose={() => setAsk(null)}>
          <p className="mt-0 text-ink2">
            The rig goes back to the snapshot from {ago(utc(ask.snapshot.createdAt))} ago ({ask.snapshot.createdAt} UTC). Seats restart from that
            point; anything since then is not brought back. This cannot be undone from RigApp, but newer snapshots stay in the list.
          </p>
          <p className="text-xs text-ink3">{NOTICE}</p>
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() => run(() => request({ method: "rig.restore", rigId: project.id, snapshotId: ask.snapshot.id }), "Restore started.")}
            >
              Restore
            </Button>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
