import { Check, X } from "lucide-react";
import { useState } from "react";
import type { Seat } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { Button } from "../ui/button";

type Digit = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/**
 * Shown while a seat waits on you. OpenRig gives no prompt text or answer route
 * (systems.md gap 2): the text is the bottom of the seat's pane, and the buttons
 * press Enter or Escape in it.
 */
export function ApprovalCard({ seat, compact = false }: { seat: Seat; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answer = async (key: "approve" | "deny" | Digit) => {
    setBusy(key);
    const result = await request({ method: "seat.key", session: seat.session, key });
    setBusy(null);
    setError(result.ok ? null : (result.error ?? "That did not work."));
  };
  // Drop blank lines so the question and its choices sit together.
  const lines = (seat.prompt ?? "").split("\n").filter((l) => l.trim());
  // Claude Code's numbered choice that stops it asking again for this kind of command.
  const always = lines.map((l) => /^\W*([1-9])\.\s+Yes, and don.t ask again/.exec(l.trim())?.[1]).find(Boolean) as Digit | undefined;
  return (
    <div className="rounded-lg bg-g2 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-warn">
        <span className="size-2 rounded-full bg-warn" aria-hidden />
        {seat.logicalId} is waiting on you
      </div>
      {lines.length > 0 && (
        <pre className="m-0 max-h-56 overflow-auto rounded-md bg-g0 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-ink2">
          {lines.slice(compact ? -6 : -16).join("\n")}
        </pre>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <Button onClick={() => answer("approve")} disabled={busy !== null}>
          <Check />
          {busy === "approve" ? "Approving" : "Approve"}
        </Button>
        {always && (
          <Button variant="ghost" className="bg-g3" onClick={() => answer(always)} disabled={busy !== null}>
            {busy === always ? "Allowing" : "Always allow"}
          </Button>
        )}
        <Button variant="ghost" onClick={() => answer("deny")} disabled={busy !== null}>
          <X />
          {busy === "deny" ? "Denying" : "Deny"}
        </Button>
        <span className="text-xs text-ink3">
          Approve presses Enter{always ? `, Always allow picks choice ${always}` : ""}, Deny presses Esc in the seat.
        </span>
      </div>
      {error && <p className="mt-2 mb-0 text-xs text-err">{error}</p>}
    </div>
  );
}
