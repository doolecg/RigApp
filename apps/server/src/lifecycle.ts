import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import type { ClientMessage, FoundSession, LibrarySpec, SearchHit, SnapshotInfo, SpecFile, UsageWindow } from "@rigapp/contracts";
import type { Hub } from "./hub.ts";

type Request = Extract<
  ClientMessage,
  {
    method:
      | "specs.load"
      | "specs.validate"
      | "specs.save"
      | "rig.up"
      | "rig.down"
      | "rig.snapshots"
      | "rig.snapshot"
      | "rig.restore"
      | "library"
      | "up.spec"
      | "usage"
      | "search"
      | "adopt.scan"
      | "adopt"
      | "bundle.create"
      | "bundle.inspect"
      | "bundle.install";
  }
>;
export type LifecycleMethod = Request["method"];
export interface Answer {
  ok: boolean;
  error?: string;
  data?: unknown;
}

/** One daemon call. The body is JSON, or text when `text` is set (the spec validator wants raw YAML). */
async function call(url: string, method: string, path: string, body?: unknown, text = false, sender?: string | null) {
  const res = await fetch(url + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": text ? "text/yaml" : "application/json" }),
      ...(sender ? { "x-openrig-session": sender } : {}),
    },
    body: body === undefined ? undefined : text ? String(body) : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = JSON.parse(raw);
  } catch {
    // YAML or plain text answers stay as text.
  }
  return { ok: res.ok, status: res.status, json, raw, headers: res.headers };
}

function failure(json: unknown, status: number): string {
  const body = json as { error?: string; message?: string; reason?: string; errors?: string[] } | string;
  if (typeof body === "string") return body.slice(0, 300) || `OpenRig answered ${status}.`;
  return body?.message ?? body?.errors?.join("; ") ?? body?.error ?? body?.reason ?? `OpenRig answered ${status}.`;
}

type FileRoot = { name: string; path: string };
const READ_ONLY = "This file is outside OpenRig's files roots (set OPENRIG_FILES_ALLOWLIST to edit it), so it is read-only here.";

/** A file under one of the daemon's files roots, read through `/api/files/read` so it can be saved safely. */
async function readUnderRoot(url: string, roots: FileRoot[], absPath: string): Promise<Omit<SpecFile, "id" | "name" | "kind"> | null> {
  const root = roots.find((r) => absPath.startsWith(`${r.path}/`));
  if (!root) return null;
  const path = absPath.slice(root.path.length + 1);
  const read = await call(url, "GET", `/api/files/read?root=${encodeURIComponent(root.name)}&path=${encodeURIComponent(path)}`);
  const file = read.json as { content?: string; mtime?: string; contentHash?: string };
  if (!read.ok || typeof file.content !== "string") return null;
  return { content: file.content, editable: true, root: root.name, path, mtime: file.mtime, hash: file.contentHash };
}

/**
 * The folder an agent_ref points at, as OpenRig resolves it: `local:` is relative to the
 * rig's folder, `path:` is absolute. Other kinds (`builtin:terminal`) have no agent.yaml.
 */
export function agentFolder(ref: string, rigRoot: string): string | null {
  if (ref.startsWith("local:")) return ref.length > 6 ? posix.resolve(rigRoot, ref.slice(6)) : null;
  if (ref.startsWith("path:")) return ref.length > 5 ? ref.slice(5) : null;
  return null;
}

/**
 * The rig's spec, culture and agent files. Files under one of the daemon's files roots are
 * read and saved through `/api/files/*`; anything else (built-in specs) is shown read-only.
 * One agent.yaml per distinct agent the seats use, whatever their harness.
 */
async function loadSpecs(url: string, hub: Hub, rigId: string): Promise<SpecFile[]> {
  const exported = await call(url, "GET", `/api/rigs/${rigId}/spec`);
  if (!exported.ok) throw new Error(failure(exported.json, exported.status));
  const rigRoot = decodeURIComponent(exported.headers.get("x-rig-root") ?? "");
  const roots = ((await call(url, "GET", "/api/files/roots")).json as { roots?: FileRoot[] }).roots ?? [];
  const files: SpecFile[] = [];

  const rig = (await readUnderRoot(url, roots, `${rigRoot}/rig.yaml`)) ?? { content: exported.raw, editable: false, reason: READ_ONLY };
  files.push({ id: "rig.yaml", name: "rig.yaml", kind: "rig", ...rig });

  const culture = (await readUnderRoot(url, roots, `${rigRoot}/CULTURE.md`)) ?? (await readOnly(hub, `${rigRoot}/CULTURE.md`));
  if (culture) files.push({ id: "CULTURE.md", name: "CULTURE.md", kind: "culture", ...culture });

  const seen = new Set<string>();
  const refs = hub.projects().find((p) => p.id === rigId)?.pods.flatMap((pod) => pod.seats.map((seat) => seat.agentRef)) ?? [];
  for (const ref of refs) {
    const folder = ref ? agentFolder(ref, rigRoot) : null;
    if (!ref || !folder || seen.has(folder)) continue;
    seen.add(folder);
    const file = (await readUnderRoot(url, roots, `${folder}/agent.yaml`)) ?? (await readOnly(hub, `${folder}/agent.yaml`));
    if (!file) continue;
    const name = /^name: *["']?([\w .-]+)/m.exec(file.content)?.[1]?.trim() || posix.basename(folder);
    files.push({ id: ref, name, kind: "agent", ...file });
  }
  return files;
}

async function readOnly(hub: Hub, absPath: string): Promise<Omit<SpecFile, "id" | "name" | "kind"> | null> {
  const text = await readFile(hub.localPath(absPath), "utf8").catch(() => null);
  return text === null ? null : { content: text, editable: false, reason: READ_ONLY };
}

export async function lifecycle(hub: Hub, request: Request): Promise<Answer> {
  const url = hub.url;
  try {
    switch (request.method) {
      case "specs.load":
        return { ok: true, data: await loadSpecs(url, hub, request.rigId) };
      case "specs.validate": {
        const r = await call(url, "POST", request.agent ? "/api/agents/validate" : "/api/rigs/import/validate", request.content, true);
        const body = r.json as { valid?: boolean; errors?: string[] };
        return { ok: true, data: { valid: !!body.valid, errors: body.errors ?? [] } };
      }
      case "specs.save": {
        // OpenRig records who wrote a file; RigApp writes as the rig's terminal seat, the human.
        const human = hub.projects().find((p) => p.id === request.rigId)?.human;
        const r = await call(
          url,
          "POST",
          "/api/files/write",
          {
            root: request.root,
            path: request.path,
            content: request.content,
            expectedMtime: request.mtime,
            expectedContentHash: request.hash,
            ...(human ? {} : { actor: "rigapp" }),
          },
          false,
          human,
        );
        if (r.status === 409) return { ok: false, error: "The file changed on disk since you opened it. Reload it, then make your change again." };
        return r.ok ? { ok: true } : { ok: false, error: failure(r.json, r.status) };
      }
      case "rig.up": {
        const r = await call(url, "POST", `/api/rigs/${request.rigId}/up`, request.plan ? { plan: true } : {});
        hub.nudge();
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status), data: r.json };
      }
      case "up.spec": {
        const r = await call(url, "POST", "/api/up", {
          sourceRef: request.sourceRef,
          plan: request.plan,
          cwdOverride: request.cwd,
          rigName: request.rigName,
          ...(request.plan ? {} : { autoApprove: true }),
        });
        hub.nudge();
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status), data: r.json };
      }
      case "rig.down": {
        const r = await call(url, "POST", "/api/down", { rigId: request.rigId, snapshot: request.snapshot });
        hub.nudge();
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status) };
      }
      case "rig.snapshots": {
        const r = await call(url, "GET", `/api/rigs/${request.rigId}/snapshots`);
        if (!r.ok) return { ok: false, error: failure(r.json, r.status) };
        const list = (r.json as { id: string; kind: string; status: string; createdAt: string }[]).map(
          ({ id, kind, status, createdAt }): SnapshotInfo => ({ id, kind, status, createdAt }),
        );
        return { ok: true, data: list };
      }
      case "rig.snapshot": {
        const r = await call(url, "POST", `/api/rigs/${request.rigId}/snapshots`, { kind: "manual" });
        hub.nudge();
        return r.ok ? { ok: true } : { ok: false, error: failure(r.json, r.status) };
      }
      case "rig.restore": {
        const r = await call(url, "POST", `/api/rigs/${request.rigId}/restore/${request.snapshotId}`, {});
        hub.nudge();
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status) };
      }
      case "library": {
        const r = await call(url, "GET", "/api/specs/library");
        const all = (r.json as (LibrarySpec & { kind: string })[]) ?? [];
        return { ok: true, data: all.filter((s) => s.kind === "rig").map(({ id, name, version, summary, sourcePath }) => ({ id, name, version, summary, sourcePath })) };
      }
      case "usage": {
        const r = await call(url, "GET", "/api/provider/usage");
        const hosts = (r.json as { hostUsage?: { provider: string; windows: (UsageWindow & { asOf: string })[] }[] }).hostUsage ?? [];
        // Each seat reports the same account windows; keep the newest reading of each.
        const newest = new Map<string, UsageWindow>();
        for (const host of hosts)
          for (const w of host.windows) {
            const key = `${host.provider}:${w.window}`;
            const seen = newest.get(key);
            if (!seen || w.asOf > seen.asOf) newest.set(key, { provider: host.provider, window: w.window, usedPercent: w.usedPercent, resetsAt: w.resetsAt, asOf: w.asOf });
          }
        return { ok: true, data: [...newest.values()] };
      }
      case "adopt.scan": {
        await call(url, "POST", "/api/discovery/scan", {});
        const r = await call(url, "GET", "/api/discovery?status=active");
        const list = (r.json as { id: string; tmuxSession: string; cwd: string | null; runtimeHint: string }[]) ?? [];
        return { ok: true, data: list.map((d): FoundSession => ({ id: d.id, session: d.tmuxSession, cwd: d.cwd, runtime: d.runtimeHint })) };
      }
      case "adopt": {
        const r = await call(url, "POST", `/api/discovery/${encodeURIComponent(request.discoveryId)}/adopt`, {
          rigId: request.rigId,
          target: { kind: "pod", podId: request.podId, podNamespace: request.podName, memberName: request.member },
        });
        hub.nudge();
        return r.ok ? { ok: true } : { ok: false, error: failure(r.json, r.status) };
      }
      case "bundle.create": {
        const exported = await call(url, "GET", `/api/rigs/${request.rigId}/spec`);
        const rigRoot = decodeURIComponent(exported.headers.get("x-rig-root") ?? "");
        const name = hub.projects().find((p) => p.id === request.rigId)?.name ?? "rig";
        const roots = ((await call(url, "GET", "/api/files/roots")).json as { roots?: { name: string; path: string }[] }).roots ?? [];
        const workspace = roots.find((r) => r.name === "workspace")?.path;
        if (!rigRoot || !workspace) return { ok: false, error: "OpenRig gave no rig folder or workspace to write the bundle to." };
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
        const outputPath = `${workspace}/bundles/${name}-${stamp}.rigbundle`;
        const r = await call(url, "POST", "/api/bundles/create", {
          specPath: `${rigRoot}/rig.yaml`,
          rigRoot,
          bundleName: name,
          bundleVersion: "1.0.0",
          outputPath,
        });
        return r.ok ? { ok: true, data: { path: outputPath } } : { ok: false, error: failure(r.json, r.status) };
      }
      case "bundle.inspect": {
        const r = await call(url, "POST", "/api/bundles/inspect", { bundlePath: request.path });
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status) };
      }
      case "bundle.install": {
        const r = await call(url, "POST", "/api/bundles/install", {
          bundlePath: request.path,
          plan: request.plan,
          ...(request.plan ? {} : { targetRoot: request.targetRoot, autoApprove: true }),
        });
        hub.nudge();
        return r.ok ? { ok: true, data: r.json } : { ok: false, error: failure(r.json, r.status), data: r.json };
      }
      case "search": {
        const seats = hub.allSeats();
        const hits = await Promise.all(
          seats.map(async (seat): Promise<SearchHit[]> => {
            const r = await call(url, "GET", `/api/transcripts/${encodeURIComponent(seat.session)}/grep?pattern=${encodeURIComponent(request.pattern)}`);
            const matches = r.ok ? ((r.json as { matches?: string[] }).matches ?? []) : [];
            return matches.slice(-5).map((line) => ({ session: seat.session, logicalId: seat.logicalId, line: line.trim() }));
          }),
        );
        return { ok: true, data: hits.flat().slice(0, 60) };
      }
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
