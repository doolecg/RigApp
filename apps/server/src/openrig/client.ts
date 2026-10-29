import type { Project } from "@rigapp/contracts";
import { buildProject } from "./project.ts";
import type { Health, NodeEntry, PsEntry, RigDetail } from "./types.ts";

// Node's fetch sends no Origin header, which the daemon requires
// (it refuses browser origins with 403 browser_origin_refused).
export async function daemonGet<T>(url: string, path: string, timeoutMs = 5000): Promise<T> {
  const res = await fetch(url + path, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function health(url: string): Promise<Health | null> {
  try {
    const h = await daemonGet<Health>(url, "/healthz", 2000);
    return h.status === "ok" ? h : null;
  } catch {
    return null;
  }
}

export async function loadProjects(url: string): Promise<Project[]> {
  const ps = await daemonGet<PsEntry[]>(url, "/api/ps");
  return Promise.all(
    ps
      .filter((p) => !p.isArchived)
      .map(async (p) => {
        const [rig, nodes] = await Promise.all([
          daemonGet<RigDetail>(url, `/api/rigs/${p.rigId}`),
          daemonGet<NodeEntry[]>(url, `/api/rigs/${p.rigId}/nodes`),
        ]);
        return buildProject(p, rig, nodes);
      }),
  );
}
