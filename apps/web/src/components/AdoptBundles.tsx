import { useState } from "react";
import type { FoundSession, Project } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { title } from "@/lib/seat";
import { toLinuxPath } from "./NewProject";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";

const field = "w-full rounded-md bg-g0 px-2.5 py-1.5 text-ink outline-none focus:outline-acc";

/** Bring tmux sessions no rig owns into this rig, and pack or unpack the rig as a bundle. */
export function AdoptBundles({ project }: { project: Project }) {
  const [found, setFound] = useState<FoundSession[] | null>(null);
  const [adopting, setAdopting] = useState<FoundSession | null>(null);
  const [pod, setPod] = useState(project.pods[0]?.name ?? "");
  const [member, setMember] = useState("");
  const [bundle, setBundle] = useState("");
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<{ ok: boolean; text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const scan = async () => {
    const r = await request({ method: "adopt.scan" });
    setFound(r.ok ? (r.data as FoundSession[]) : []);
    if (!r.ok) setMessage(r.error ?? "The scan failed.");
  };

  const adopt = async () => {
    const chosen = project.pods.find((p) => p.name === pod);
    if (!adopting || !chosen || !member.trim()) return;
    const r = await request({ method: "adopt", discoveryId: adopting.id, rigId: project.id, podId: chosen.id, podName: chosen.name, member: member.trim() });
    setMessage(r.ok ? `${adopting.session} is now ${chosen.name}.${member.trim()}.` : (r.error ?? "Adopting failed."));
    setAdopting(null);
    void scan();
  };

  const exportBundle = async () => {
    const r = await request({ method: "bundle.create", rigId: project.id });
    if (r.ok) setBundle((r.data as { path: string }).path);
    setMessage(r.ok ? `Saved ${(r.data as { path: string }).path} (in WSL).` : (r.error ?? "The export failed."));
  };

  const install = async (planOnly: boolean) => {
    const r = await request({ method: "bundle.install", path: toLinuxPath(bundle), targetRoot: toLinuxPath(target), plan: planOnly });
    const stages = ((r.data as { stages?: { stage: string; status: string }[] }) ?? {}).stages ?? [];
    const text = stages.map((s) => `${s.stage.replaceAll("_", " ")}: ${s.status}`).join("\n") + (r.ok ? "" : `\n${r.error ?? ""}`);
    if (planOnly) setPlan({ ok: r.ok, text });
    else {
      setPlan(null);
      setMessage(r.ok ? "The bundle is installing; its rig shows in the sidebar in a moment." : text);
    }
  };

  return (
    <div className="mt-6">
      <h2 className="mt-0 mb-2 text-xs font-normal text-ink3">Adopt tmux sessions</h2>
      <Button variant="ghost" className="h-7 bg-g2" onClick={scan}>
        Look for sessions no rig owns
      </Button>
      {found?.length === 0 && <p className="mt-2 mb-0 text-xs text-ink3">None found: every tmux session belongs to a rig.</p>}
      <ul className="m-0 mt-2 list-none space-y-1 p-0">
        {found?.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-md bg-g2 px-2.5 py-1.5 text-xs">
            <span className="font-mono">{s.session}</span>
            <span className="truncate text-ink3">{s.runtime}</span>
            <Button variant="ghost" className="ml-auto h-6 px-2" onClick={() => (setAdopting(s), setMember(s.session.replace(/[^a-z0-9-]/gi, "-").toLowerCase()))}>
              Adopt
            </Button>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 mb-2 text-xs font-normal text-ink3">Bundles</h2>
      <Button variant="ghost" className="h-7 bg-g2" onClick={exportBundle}>
        Export {project.name} as a bundle
      </Button>
      <label className="mt-3 mb-1 block text-xs text-ink2" htmlFor="bundle-path">
        Bundle to install (a WSL path, or a Windows path on a drive)
      </label>
      <input id="bundle-path" className={field} value={bundle} onChange={(e) => (setBundle(e.target.value), setPlan(null))} />
      <label className="mt-2 mb-1 block text-xs text-ink2" htmlFor="bundle-target">
        Folder to install it into
      </label>
      <input id="bundle-target" className={field} value={target} onChange={(e) => (setTarget(e.target.value), setPlan(null))} />
      <div className="mt-2 flex gap-2">
        <Button variant="ghost" className="h-7 bg-g2" disabled={!bundle.trim()} onClick={() => install(true)}>
          Check with OpenRig
        </Button>
        <Button className="h-7" disabled={!plan?.ok || !target.trim()} onClick={() => install(false)}>
          Install
        </Button>
      </div>
      {plan && <pre className={`mt-2 mb-0 rounded-md bg-g0 px-3 py-2 font-mono text-xs whitespace-pre-wrap ${plan.ok ? "text-ink2" : "text-err"}`}>{plan.text}</pre>}
      {message && <p className="mt-2 mb-0 text-xs text-ink2">{message}</p>}

      {adopting && (
        <Modal title={`Adopt ${adopting.session}?`} onClose={() => setAdopting(null)}>
          <p className="mt-0 text-ink2">
            It becomes a seat of {project.name}. OpenRig then tracks it like any other seat. Running in {adopting.cwd ?? "an unknown folder"}.
          </p>
          <label className="mb-1 block text-xs text-ink2" htmlFor="adopt-pod">
            Pod
          </label>
          <select id="adopt-pod" className={`${field} mb-2`} value={pod} onChange={(e) => setPod(e.target.value)}>
            {project.pods.map((p) => (
              <option key={p.id} value={p.name}>
                {title(p.name)}
              </option>
            ))}
          </select>
          <label className="mb-1 block text-xs text-ink2" htmlFor="adopt-member">
            Seat name
          </label>
          <input id="adopt-member" className={`${field} mb-3`} value={member} onChange={(e) => setMember(e.target.value)} />
          <div className="flex gap-2">
            <Button disabled={!member.trim()} onClick={adopt}>
              Adopt
            </Button>
            <Button variant="ghost" onClick={() => setAdopting(null)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
