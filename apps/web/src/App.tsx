import { ChevronRight, FileCode, Menu, MessageSquare, Network, PanelLeft, PanelRight, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useConnection } from "@/lib/connection";
import { seatState } from "@/lib/seat";
import { initSeen, markSeen } from "@/lib/seen";
import { useMedia, useStored } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./components/chat/ApprovalCard";
import { Chat } from "./components/chat/Chat";
import { Composer } from "./components/chat/Composer";
import { GraphView } from "./components/GraphView";
import { Overview } from "./components/Overview";
import { Palette } from "./components/Palette";
import { SeatPanel } from "./components/SeatPanel";
import { SetupScreen } from "./components/SetupScreen";
import { SpecsView } from "./components/SpecsView";
import { Sidebar } from "./components/Sidebar";
import { StatusDot } from "./components/StatusDot";
import { TerminalView } from "./components/TerminalView";
import { Button } from "./components/ui/button";

const SIDEBAR_WIDTH = 268;
const clampWidth = (width: number) => Math.min(420, Math.max(220, width));

export type View = "overview" | "seat";
type Tab = "chat" | "graph" | "terminal" | "specs";

const TABS: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "graph", label: "Graph", icon: Network },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "specs", label: "Specs", icon: FileCode },
];

export function App() {
  const { connected, shell } = useConnection();
  const [view, setView] = useStored<View>("rigapp.view", "seat");
  const [chosen, setChosen] = useStored<string | null>("rigapp.lastSeat", null);
  const [tab, setTab] = useStored<Tab>("rigapp.tab", "chat");
  const [sidebarWidth, setSidebarWidth] = useStored("rigapp.sidebarWidth", SIDEBAR_WIDTH);
  const [sidebarOpen, setSidebarOpen] = useStored("rigapp.sidebarOpen", true);
  const [panelOpen, setPanelOpen] = useStored("rigapp.panelOpen", true);
  // Below these widths the sidebar and the details panel float over the chat
  // instead of taking columns; their open state then is not saved.
  const wide = useMedia("(min-width: 768px)");
  const roomy = useMedia("(min-width: 1280px)");
  const [drawer, setDrawer] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [palette, setPalette] = useState(false);

  const projects = shell?.daemon.ok ? shell.projects : [];
  const seats = projects.flatMap((project) => project.pods.flatMap((pod) => pod.seats.map((seat) => ({ project, seat }))));
  // The last seat you opened, else the first project's lead.
  const current =
    seats.find((s) => s.seat.session === chosen) ??
    seats.find((s) => s.seat.session === projects[0]?.lead) ??
    seats[0];
  const viewing = view === "seat" ? current?.seat : undefined;

  useEffect(() => {
    if (shell?.daemon.ok) initSeen(shell);
  }, [shell]);
  // While a thread is open, everything it shows counts as seen.
  useEffect(() => {
    if (viewing) markSeen(viewing.session);
  }, [viewing?.session, viewing?.lastActivityAt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
        return;
      }
      if (event.key !== "Escape") return;
      setDrawer(false);
      setOverlay(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  if (!shell) {
    return (
      <div className="grid h-full place-items-center text-ink2">
        {connected ? "Loading" : "Connecting to the RigApp server"}
      </div>
    );
  }
  if (!shell.daemon.ok) return <SetupScreen shell={shell} />;

  const select = (session: string) => {
    setChosen(session);
    setView("seat");
    setDrawer(false);
  };
  const openOverview = () => {
    setView("overview");
    setDrawer(false);
  };

  const showSidebar = wide && sidebarOpen;
  const showPanel = view === "seat" && (roomy ? panelOpen : overlay);
  const toggleSidebar = () => (wide ? setSidebarOpen(!sidebarOpen) : setDrawer(!drawer));
  const togglePanel = () => (roomy ? setPanelOpen(!panelOpen) : setOverlay(!overlay));
  const sidebar = (
    <Sidebar
      shell={shell}
      view={view}
      selected={current?.seat.session ?? null}
      onSelect={select}
      onOverview={openOverview}
      onSearch={() => setPalette(true)}
      onHide={toggleSidebar}
    />
  );

  return (
    <div className="relative flex h-full overflow-hidden">
      {showSidebar && (
        <div className="relative shrink-0" style={{ width: sidebarWidth }}>
          {sidebar}
          <ResizeHandle width={sidebarWidth} onResize={setSidebarWidth} />
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col bg-g1">
        <header className="flex min-h-12 items-center gap-2 px-3 py-2.5">
          {!showSidebar && (
            <Button variant="ghost" size="icon" aria-label="Show sidebar" onClick={toggleSidebar}>
              {wide ? <PanelLeft /> : <Menu />}
            </Button>
          )}
          {view === "overview" ? (
            <span className="font-semibold">Overview</span>
          ) : (
            current && (
              <>
                <span className="hidden text-ink2 sm:inline">{current.project.name}</span>
                <ChevronRight className="hidden size-3.5 text-ink3 sm:inline" />
                <StatusDot tone={seatState(current.seat).tone} className="sm:hidden" />
                <span className="truncate font-semibold">{current.seat.logicalId}</span>
                <span className="hidden rounded bg-g3 px-1.5 py-0.5 text-xs text-ink2 sm:inline">
                  {current.seat.harness}
                </span>
                <span className="hidden items-center gap-1.5 text-xs text-ink2 sm:inline-flex">
                  <StatusDot tone={seatState(current.seat).tone} />
                  {seatState(current.seat).label}
                </span>
                <nav className="ml-2 flex items-center gap-0.5 rounded-lg bg-g0 p-0.5" role="tablist" aria-label="Thread views">
                  {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={tab === id}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-ink2 hover:text-ink",
                        tab === id && "bg-g3 text-ink",
                      )}
                      onClick={() => setTab(id)}
                    >
                      <Icon className="size-3.5" />
                      <span className="hidden md:inline">{label}</span>
                    </button>
                  ))}
                </nav>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label={showPanel ? "Hide details" : "Show details"}
                  aria-pressed={showPanel}
                  onClick={togglePanel}
                >
                  <PanelRight />
                </Button>
              </>
            )
          )}
        </header>
        {view === "overview" ? (
          <Overview shell={shell} onOpen={select} />
        ) : current && tab === "graph" ? (
          <GraphView
            project={current.project}
            onOpen={(session) => {
              select(session);
              setTab("chat");
            }}
          />
        ) : current && tab === "specs" ? (
          <SpecsView key={current.project.id} project={current.project} />
        ) : current && tab === "terminal" ? (
          <TerminalView key={current.seat.session} seat={current.seat} />
        ) : current ? (
          <>
            <Chat key={current.seat.session} seat={current.seat} />
            {current.seat.activity === "needs_input" && (
              <div className="mx-auto w-full max-w-[760px] px-3 pb-2 sm:px-6">
                <ApprovalCard seat={current.seat} />
              </div>
            )}
            <Composer key={`composer-${current.seat.session}`} project={current.project} seat={current.seat} />
          </>
        ) : (
          <p className="m-auto text-ink2">OpenRig has no rigs yet.</p>
        )}
      </main>
      {current && showPanel && (
        <div className={roomy ? "w-[320px] shrink-0" : "absolute inset-y-0 right-0 z-20 w-[min(340px,90vw)] [&>aside]:bg-g2"}>
          <SeatPanel project={current.project} seat={current.seat} onHide={roomy ? undefined : togglePanel} />
        </div>
      )}
      <Palette
        shell={shell}
        open={palette}
        onOpenChange={setPalette}
        actions={{ openSeat: select, openOverview, toggleSidebar, togglePanel }}
      />
      {!wide && drawer && (
        <div className="absolute inset-0 z-30 flex">
          <div className="w-[min(320px,85vw)]">{sidebar}</div>
          <button aria-label="Close sidebar" className="flex-1 bg-black/40" onClick={() => setDrawer(false)} />
        </div>
      )}
    </div>
  );
}

/** Drag, or focus and use the arrow keys, to size the sidebar. Double-click resets it. */
function ResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none hover:bg-g3/70 focus-visible:bg-acc-soft"
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) onResize(clampWidth(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => onResize(SIDEBAR_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(clampWidth(width - 16));
        if (event.key === "ArrowRight") onResize(clampWidth(width + 16));
      }}
    />
  );
}
