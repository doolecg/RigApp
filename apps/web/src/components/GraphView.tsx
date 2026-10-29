import { Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Project, Seat } from "@rigapp/contracts";
import { seatState, title } from "@/lib/seat";
import { StatusDot } from "./StatusDot";

const SEAT_W = 190;
const SEAT_H = 52;
const GAP = 18;
const POD_PAD = 34;
const POD_H = POD_PAD + SEAT_H + GAP;
const ROW_GAP = 110;
const COL_GAP = 80;

type SeatNode = Node<{ seat: Seat; lead: boolean }, "seat">;
type PodNode = Node<{ name: string }, "pod">;

function SeatBox({ data }: NodeProps<SeatNode>) {
  const state = seatState(data.seat);
  return (
    <div
      className={`flex h-full cursor-pointer flex-col justify-center rounded-lg bg-g2 px-3 hover:bg-g3 ${data.lead ? "outline-1 outline-acc" : ""}`}
    >
      {/* Down the chain enters at the top; sideways and upward links use the other sides. */}
      <Handle id="t" type="target" position={Position.Top} className="!border-0 !bg-transparent" />
      <Handle id="tu" type="target" position={Position.Bottom} className="!border-0 !bg-transparent" />
      <Handle id="rt" type="target" position={Position.Right} className="!border-0 !bg-transparent" />
      <div className="flex items-center gap-2">
        <StatusDot tone={state.tone} />
        <span className="font-semibold text-ink">{data.seat.logicalId}</span>
      </div>
      <span className="pl-4 text-xs text-ink3">
        {data.seat.harness}
        {data.lead && " · lead"} · {state.label.toLowerCase()}
      </span>
      <Handle id="b" type="source" position={Position.Bottom} className="!border-0 !bg-transparent" />
      <Handle id="r" type="source" position={Position.Right} className="!border-0 !bg-transparent" />
    </div>
  );
}

function PodBox({ data }: NodeProps<PodNode>) {
  return <div className="h-full rounded-xl bg-g2/50 px-3.5 pt-2 text-xs text-ink3">{title(data.name)}</div>;
}

const nodeTypes = { seat: SeatBox, pod: PodBox };

const SHORT: Record<string, string> = {
  delegates_to: "delegates",
  escalates_to: "escalates",
  collaborates_with: "collaborates",
  can_observe: "observes",
  spawned_by: "spawned by",
};

/**
 * Pods in rows by how far they are down the delegation chain from the lead, each pod
 * a box of its seats side by side. OpenRig's graph route sends no usable positions.
 */
function layout(project: Project): { nodes: Node[]; edges: Edge[] } {
  const rank = new Map<string, number>();
  if (project.lead) rank.set(project.lead, 0);
  for (let changed = true; changed; ) {
    changed = false;
    for (const e of project.edges) {
      const from = rank.get(e.from);
      if (e.kind === "delegates_to" && from !== undefined && !rank.has(e.to)) {
        rank.set(e.to, from + 1);
        changed = true;
      }
    }
  }
  const podRank = (seats: Seat[]) => Math.min(...seats.map((s) => rank.get(s.session) ?? 1));
  const rows = new Map<number, typeof project.pods>();
  for (const pod of project.pods) rows.set(podRank(pod.seats), [...(rows.get(podRank(pod.seats)) ?? []), pod]);

  const nodes: Node[] = [];
  for (const [r, pods] of [...rows].sort((a, b) => a[0] - b[0])) {
    const widths = pods.map((p) => p.seats.length * (SEAT_W + GAP) + GAP);
    let x = -(widths.reduce((a, b) => a + b, 0) + COL_GAP * (pods.length - 1)) / 2;
    pods.forEach((pod, i) => {
      const id = `pod:${pod.name}`;
      nodes.push({
        id,
        type: "pod",
        position: { x, y: r * (POD_H + ROW_GAP) },
        data: { name: pod.name },
        style: { width: widths[i], height: POD_H },
        selectable: false,
        draggable: false,
      });
      pod.seats.forEach((seat, j) =>
        nodes.push({
          id: seat.session,
          type: "seat",
          parentId: id,
          extent: "parent",
          position: { x: GAP + j * (SEAT_W + GAP), y: POD_PAD },
          data: { seat, lead: project.lead === seat.session },
          style: { width: SEAT_W, height: SEAT_H },
          draggable: false,
        }),
      );
      x += widths[i]! + COL_GAP;
    });
  }

  // Seat rows, to pick which side each link leaves and enters by.
  const row = new Map<string, number>();
  for (const node of nodes) if (node.type === "seat") row.set(node.id, nodes.find((p) => p.id === node.parentId)!.position.y);
  // Two links between the same seats share one line with both names.
  const pairs = new Map<string, { from: string; to: string; kinds: string[] }>();
  for (const e of project.edges) {
    const key = `${e.from}>${e.to}`;
    const pair = pairs.get(key) ?? { from: e.from, to: e.to, kinds: [] };
    pair.kinds.push(e.kind);
    pairs.set(key, pair);
  }
  const edges: Edge[] = [...pairs.values()].map((e) => {
    const escalates = e.kinds.includes("escalates_to") && e.kinds.length === 1;
    const [from, to] = [row.get(e.from) ?? 0, row.get(e.to) ?? 0];
    // Down the chain: bottom to top. Same row: under the seats. Back up: round the right side.
    const [sourceHandle, targetHandle] = from === to ? ["b", "tu"] : from > to ? ["r", "rt"] : ["b", "t"];
    return {
      id: `${e.from}>${e.to}`,
      source: e.from,
      target: e.to,
      sourceHandle,
      targetHandle,
      label: e.kinds.map((k) => SHORT[k] ?? k).join(" · "),
      type: from === to ? "smoothstep" : "default",
      style: { stroke: escalates ? "var(--warn)" : "var(--ink3)", strokeDasharray: escalates ? "5 4" : undefined },
      labelStyle: { fill: escalates ? "var(--warn)" : "var(--ink2)", fontSize: 11 },
      labelBgStyle: { fill: "var(--g1)" },
    };
  });
  return { nodes, edges };
}

/** The rig's pods, seats and links, with live status; click a seat to open its thread. */
export function GraphView({ project, light, onOpen }: { project: Project; light: boolean; onOpen: (session: string) => void }) {
  const { nodes, edges } = layout(project);
  return (
    <div className="relative min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={light ? "light" : "dark"}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesConnectable={false}
        onNodeClick={(_, node) => node.type === "seat" && onOpen(node.id)}
        style={{ background: "var(--g1)" }}
      >
        <Controls showInteractive={false} position="top-right" />
      </ReactFlow>
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-lg bg-g2 px-3 py-1.5 text-xs text-ink2">
        <span className="flex items-center gap-1.5"><StatusDot tone="acc" />Working</span>
        <span className="flex items-center gap-1.5"><StatusDot tone="warn" />Waiting</span>
        <span className="flex items-center gap-1.5"><StatusDot tone="idle" />Idle</span>
        <span className="flex items-center gap-1.5"><StatusDot tone="err" />Error</span>
        <span className="text-ink3">Click a seat to open it</span>
      </div>
    </div>
  );
}
