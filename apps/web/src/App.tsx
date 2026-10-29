import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useConnection } from "@/lib/connection";
import { seatState } from "@/lib/seat";
import { SeatPanel } from "./components/SeatPanel";
import { SetupScreen } from "./components/SetupScreen";
import { Sidebar } from "./components/Sidebar";
import { StatusDot } from "./components/StatusDot";

const LAST_SEAT = "rigapp.lastSeat";

export function App() {
  const { connected, shell } = useConnection();
  const [chosen, setChosen] = useState(() => localStorage.getItem(LAST_SEAT));

  if (!shell) {
    return (
      <div className="grid h-full place-items-center text-ink2">
        {connected ? "Loading" : "Connecting to the RigApp server"}
      </div>
    );
  }
  if (!shell.daemon.ok) return <SetupScreen shell={shell} />;

  const seats = shell.projects.flatMap((project) =>
    project.pods.flatMap((pod) => pod.seats.map((seat) => ({ project, seat }))),
  );
  // The last seat you opened, else the first project's lead.
  const current =
    seats.find((s) => s.seat.session === chosen) ??
    seats.find((s) => s.seat.session === shell.projects[0]?.lead) ??
    seats[0];
  const select = (session: string) => {
    localStorage.setItem(LAST_SEAT, session);
    setChosen(session);
  };

  return (
    <div className="grid h-full grid-cols-[268px_1fr] xl:grid-cols-[268px_1fr_320px]">
      <Sidebar shell={shell} selected={current?.seat.session ?? null} onSelect={select} />
      <main className="flex min-h-0 flex-col bg-g1">
        {current ? (
          <header className="flex items-center gap-2 px-4 py-3">
            <span className="text-ink2">{current.project.name}</span>
            <ChevronRight className="size-3.5 text-ink3" />
            <span className="font-semibold">{current.seat.logicalId}</span>
            <span className="rounded bg-g3 px-1.5 py-0.5 text-xs text-ink2">{current.seat.harness}</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-ink2">
              <StatusDot tone={seatState(current.seat).tone} />
              {seatState(current.seat).label}
            </span>
          </header>
        ) : (
          <p className="m-auto text-ink2">OpenRig has no rigs yet.</p>
        )}
      </main>
      {current && (
        <div className="hidden min-h-0 xl:block">
          <SeatPanel project={current.project} seat={current.seat} />
        </div>
      )}
    </div>
  );
}
