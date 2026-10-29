import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import type { LibrarySpec, Shell } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";

interface Stage {
  stage: string;
  status: string;
  detail?: { errors?: string[] };
}

/** A Windows path like E:\REPOS\App becomes the WSL path /mnt/e/REPOS/App; Linux paths stay as they are. */
export function toLinuxPath(path: string): string {
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(path.trim());
  return drive ? `/mnt/${drive[1]!.toLowerCase()}/${drive[2]!.replaceAll("\\", "/")}`.replace(/\/$/, "") : path.trim();
}

/** Opens the system's folder picker (it runs on this computer, through RigApp's server). */
export function BrowseButton({ onPick }: { onPick: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        className="shrink-0 bg-g3"
        disabled={open}
        title={error ?? undefined}
        onClick={async () => {
          setOpen(true);
          const r = await request({ method: "pick.folder" });
          setOpen(false);
          setError(r.ok ? null : (r.error ?? "The folder picker did not open."));
          const path = (r.data as { path: string | null } | undefined)?.path;
          if (path) onPick(path);
        }}
      >
        <FolderOpen />
        {open ? "Picking" : "Browse"}
      </Button>
      {error && <span className="self-center text-xs text-err">{error}</span>}
    </>
  );
}

/** Start a new rig (project) from one of OpenRig's rig specs, in a folder you pick. */
export function NewProject({ shell, onClose }: { shell: Shell; onClose: () => void }) {
  const [library, setLibrary] = useState<LibrarySpec[] | null>(null);
  const [spec, setSpec] = useState<LibrarySpec | null>(null);
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<{ ok: boolean; stages: Stage[]; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void request({ method: "library" }).then((r) => setLibrary(r.ok ? (r.data as LibrarySpec[]) : []));
  }, []);

  const pick = (s: LibrarySpec) => {
    setSpec(s);
    setPlan(null);
    const taken = new Set(shell.projects.map((p) => p.name));
    let candidate = s.name;
    for (let n = 2; taken.has(candidate); n++) candidate = `${s.name}-${n}`;
    setName(candidate);
  };

  const ask = async (planOnly: boolean) => {
    if (!spec) return;
    setBusy(true);
    const r = await request({ method: "up.spec", sourceRef: spec.sourcePath, plan: planOnly, cwd: toLinuxPath(folder), rigName: name });
    setBusy(false);
    const stages = ((r.data as { stages?: Stage[] }) ?? {}).stages ?? [];
    if (planOnly) setPlan({ ok: r.ok, stages, error: r.error });
    else if (r.ok) setDone(`${name} is starting. It shows in the sidebar in a moment.`);
    else setPlan({ ok: false, stages, error: r.error });
  };

  return (
    <Modal title="New project" onClose={onClose}>
      {done ? (
        <>
          <p className="mt-0">{done}</p>
          <Button onClick={onClose}>Close</Button>
        </>
      ) : (
        <>
          <p className="mt-0 text-ink2">Pick a team from OpenRig's library, then the folder it works in.</p>
          <ul className="m-0 mb-4 max-h-56 list-none overflow-y-auto p-0">
            {library === null && <li className="text-ink3">Loading</li>}
            {library?.map((s) => (
              <li key={s.id}>
                <button
                  className={cn("w-full rounded-md px-2.5 py-1.5 text-left hover:bg-g3", spec?.id === s.id && "bg-g3")}
                  onClick={() => pick(s)}
                >
                  <span className="font-semibold">{s.name}</span>
                  <span className="block truncate text-xs text-ink2">{s.summary}</span>
                </button>
              </li>
            ))}
          </ul>
          <label className="mb-1 block text-xs text-ink2" htmlFor="np-folder">
            Project folder (a Windows path like E:\REPOS\MyApp works)
          </label>
          <div className="mb-3 flex gap-2">
            <input
              id="np-folder"
              className="w-full rounded-md bg-g0 px-2.5 py-1.5 text-ink outline-none focus:outline-acc"
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setPlan(null);
              }}
            />
            <BrowseButton
              onPick={(path) => {
                setFolder(path);
                setPlan(null);
              }}
            />
          </div>
          <label className="mb-1 block text-xs text-ink2" htmlFor="np-name">
            Project name
          </label>
          <input
            id="np-name"
            className="mb-4 w-full rounded-md bg-g0 px-2.5 py-1.5 text-ink outline-none focus:outline-acc"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setPlan(null);
            }}
          />
          {plan && (
            <div className="mb-3 rounded-lg bg-g0 px-3 py-2 text-xs">
              {plan.stages.map((s) => (
                <div key={s.stage} className={s.status === "ok" ? "text-ink2" : "text-err"}>
                  {s.stage.replaceAll("_", " ")}: {s.status}
                </div>
              ))}
              {!plan.ok && <div className="mt-1 text-err">{plan.error}</div>}
              {plan.ok && <div className="mt-1 text-acc">OpenRig can start it. Starting spends tokens in its AI seats.</div>}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="bg-g3" disabled={!spec || !folder.trim() || !name.trim() || busy} onClick={() => ask(true)}>
              Check with OpenRig
            </Button>
            <Button disabled={!plan?.ok || busy} onClick={() => ask(false)}>
              Start project
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
