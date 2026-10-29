import { Check, X } from "lucide-react";
import { request, useConnection } from "@/lib/connection";
import { Button } from "./ui/button";

/**
 * One card for each seat browser action waiting on you. It shows on every screen, because the
 * seat's call is held until you answer. Nothing runs before you press Allow.
 */
export function BrowserAsks() {
  const { browser } = useConnection();
  if (!browser?.asks.length) return null;
  return (
    <div className="mx-3 mb-2 flex flex-col gap-2">
      {browser.asks.map((ask) => {
        const answer = (choice: "once" | "all" | "deny") => void request({ method: "browser.answer", ask: ask.id, answer: choice });
        return (
          <div key={ask.id} className="rounded-lg bg-g2 p-3">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-warn">
              <span className="size-2 rounded-full bg-warn" aria-hidden />A seat wants to use the browser
            </div>
            <p className="m-0 mb-2.5 break-words">{ask.summary}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => answer("once")}>
                <Check />
                Allow once
              </Button>
              <Button variant="ghost" className="bg-g3" onClick={() => answer("all")}>
                Allow all
              </Button>
              <Button variant="ghost" onClick={() => answer("deny")}>
                <X />
                Deny
              </Button>
              <span className="text-xs text-ink3">Allow all stops asking until the browser is turned off.</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
