import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Hand, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Seat, ServerMessage } from "@rigapp/contracts";
import { onTerm, request } from "@/lib/connection";
import { Button } from "./ui/button";

type Mode = "connecting" | "live" | "preview" | "ended";

// Options from Operant's terminal (font, cursor, contrast); the terminal stays dark in both themes, as in the mockup.
const OPTIONS = {
  cursorBlink: true,
  cursorStyle: "bar" as const,
  cursorWidth: 2,
  cursorInactiveStyle: "outline" as const,
  fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'DejaVu Sans Mono', monospace",
  fontSize: 13,
  lineHeight: 1.2,
  minimumContrastRatio: 4.5,
  scrollback: 5000,
  theme: { background: "#16171a", foreground: "#e7e7e4", cursor: "#35b39b", selectionBackground: "#173a34" },
};

/**
 * The seat's tmux pane. Read-only until you take control. Live when the daemon's
 * terminal socket is on; otherwise a copy of the pane every 3 seconds.
 */
export function TerminalView({ seat }: { seat: Seat }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const [mode, setMode] = useState<Mode>("connecting");
  const [control, setControl] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new Terminal({ ...OPTIONS, disableStdin: true });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(host.current!);
    fit.fit();
    term.current = t;
    const resize = new ResizeObserver(() => fit.fit());
    resize.observe(host.current!);
    const off = onTerm(seat.session, (message: Extract<ServerMessage, { type: "term" }>) => {
      setMode(message.mode);
      if (message.mode === "live" && message.data) t.write(message.data);
      // A preview is the whole pane again: clear and redraw it.
      if (message.mode === "preview") t.write(`\x1b[2J\x1b[3J\x1b[H${(message.screen ?? "").replace(/\n/g, "\r\n")}`);
    });
    return () => {
      off();
      resize.disconnect();
      t.dispose();
    };
  }, [seat.session]);

  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.disableStdin = !control;
    if (!control) return;
    t.focus();
    const sub = t.onData((data) => {
      void request({ method: "term.input", session: seat.session, data }).then((r) => setError(r.ok ? null : (r.error ?? "The keys did not reach the seat.")));
    });
    return () => sub.dispose();
  }, [control, seat.session]);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2 py-2 text-xs text-ink2">
        <span className={mode === "live" ? "text-acc" : undefined}>
          {mode === "live" && "Live"}
          {mode === "preview" && "Copy of the pane, refreshed every 3 seconds. Turn on the daemon's terminal socket for live output."}
          {mode === "connecting" && "Connecting"}
          {mode === "ended" && "The terminal closed."}
        </span>
        <span className="ml-auto" />
        {control ? (
          <Button variant="ghost" className="h-7 bg-g3" onClick={() => setControl(false)}>
            <Lock />
            Give back control
          </Button>
        ) : (
          <Button variant="ghost" className="h-7" onClick={() => setAsking(true)}>
            <Hand />
            Take control
          </Button>
        )}
      </div>
      {asking && (
        <div className="mb-2 rounded-lg bg-g2 p-3">
          <p className="m-0 font-semibold text-warn">Take control of {seat.logicalId}'s terminal?</p>
          <p className="mt-1 mb-0 text-ink2">
            Your keys go straight into the seat's pane, as if you were typing in tmux. That can interrupt or change the
            seat's work, and RigApp cannot undo it. Provided "as is", without warranty, under the MIT licence.
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button
              onClick={() => {
                setAsking(false);
                setControl(true);
              }}
            >
              Take control
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <p className="m-0 mb-2 text-xs text-err">{error}</p>}
      <div
        ref={host}
        className={`min-h-0 flex-1 overflow-hidden rounded-lg bg-[#16171a] p-2 ${control ? "outline-2 outline-warn" : ""}`}
      />
    </div>
  );
}
