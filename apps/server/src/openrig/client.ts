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

/** The last lines of a seat's pane, through `POST /api/transport/capture`. */
async function capture(url: string, session: string, lines: number): Promise<string | null> {
  try {
    const res = await fetch(`${url}/api/transport/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session, lines }),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { ok?: boolean; content?: string };
    return body.ok ? (body.content ?? "").trimEnd() : null;
  } catch {
    return null;
  }
}

export async function loadProjects(url: string): Promise<Project[]> {
  const ps = await daemonGet<PsEntry[]>(url, "/api/ps");
  const projects = await Promise.all(
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
  // OpenRig gives no prompt text for a waiting seat (systems.md gap 2), so show
  // the bottom of its pane, where the harness draws the question.
  const waiting = projects.flatMap((p) => p.pods.flatMap((pod) => pod.seats)).filter((s) => s.activity === "needs_input");
  await Promise.all(waiting.map(async (seat) => (seat.prompt = await capture(url, seat.session, 30))));
  return projects;
}
