import { Hand, Play } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import type { BrowserInput } from "@rigapp/contracts";
import { notify, onBrowserFrame, request, useConnection } from "@/lib/connection";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const BUTTONS = ["left", "middle", "right"] as const;

/**
 * The page seats are working on, live. Looking is free; Take control lets you click, scroll and
 * type in it and refuses seat actions until you hand it back.
 */
export function BrowserView() {
  const { browser } = useConnection();
  const canvas = useRef<HTMLCanvasElement>(null);
  // The page's size in CSS pixels, from the latest picture: mouse positions are sent in these units.
  const page = useRef({ width: 1, height: 1 });
  const lastMove = useRef(0);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const control = !!browser?.control;

  useEffect(
    () =>
      onBrowserFrame((frame) => {
        const target = canvas.current;
        if (!target) return;
        page.current = { width: frame.width, height: frame.height };
        const picture = new Image();
        picture.onload = () => {
          target.width = picture.width;
          target.height = picture.height;
          target.getContext("2d")?.drawImage(picture, 0, 0);
        };
        picture.src = `data:image/jpeg;base64,${frame.data}`;
      }),
    [],
  );

  // The address bar follows the page until you start typing in it.
  const url = browser?.page?.url ?? "";
  useEffect(() => setAddress(url), [url]);

  const send = (event: BrowserInput) => notify({ method: "browser.input", event });
  const at = (event: MouseEvent | WheelEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * page.current.width, y: ((event.clientY - box.top) / box.height) * page.current.height };
  };
  const mouse = (type: "move" | "down" | "up") => (event: MouseEvent) => {
    if (!control) return;
    if (type === "move") {
      // About 30 moves a second is plenty for hover effects and dragging.
      if (Date.now() - lastMove.current < 33) return;
      lastMove.current = Date.now();
    }
    send({ kind: "mouse", type, ...at(event), button: BUTTONS[event.button] ?? "left", clicks: type === "move" ? 0 : Math.max(1, event.detail) });
  };
  const key = (type: "down" | "up") => (event: KeyboardEvent) => {
    if (!control) return;
    // Pasting is handled by onPaste, which has the clipboard text.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return;
    event.preventDefault();
    const modifiers = (event.altKey ? MODIFIERS.alt : 0) | (event.ctrlKey ? MODIFIERS.ctrl : 0) | (event.metaKey ? MODIFIERS.meta : 0) | (event.shiftKey ? MODIFIERS.shift : 0);
    const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey;
    send({ kind: "key", type, key: event.key, code: event.code, keyCode: event.keyCode, text: printable ? event.key : event.key === "Enter" ? "\r" : "", modifiers });
  };
  const paste = (event: ClipboardEvent) => {
    if (!control) return;
    event.preventDefault();
    send({ kind: "text", text: event.clipboardData.getData("text") });
  };

  const setControl = async (on: boolean) => {
    const result = await request({ method: "browser.control", on });
    setError(result.ok ? null : (result.error ?? "That did not work."));
    if (on) canvas.current?.focus();
  };
  const go = async (event: FormEvent) => {
    event.preventDefault();
    const result = await request({ method: "browser.go", url: address });
    setError(result.ok ? null : (result.error ?? "That did not work."));
  };

  if (!browser?.running) {
    return <p className="m-auto max-w-sm text-center text-ink2">The browser for seats is off. Turn it on in Settings, under Tools.</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
      <div className="flex items-center gap-2">
        <form onSubmit={go} className="min-w-0 flex-1">
          <input
            aria-label="Address"
            className="w-full rounded-md bg-g2 px-2.5 py-1.5 text-ink outline-none disabled:text-ink2"
            value={address}
            disabled={!control}
            placeholder={control ? "Type an address and press Enter" : "No page open yet"}
            onChange={(e) => setAddress(e.target.value)}
          />
        </form>
        <Button variant={control ? "default" : "ghost"} className={cn(!control && "bg-g3")} onClick={() => setControl(!control)}>
          {control ? <Play /> : <Hand />}
          {control ? "Give back to seats" : "Take control"}
        </Button>
      </div>
      {error && <p className="m-0 text-xs text-err">{error}</p>}
      <div className={cn("grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg bg-g0", control && "outline outline-2 outline-acc")}>
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label="Seat browser page"
          className="max-h-full max-w-full object-contain outline-none"
          onMouseMove={mouse("move")}
          onMouseDown={(e) => {
            canvas.current?.focus();
            mouse("down")(e);
          }}
          onMouseUp={mouse("up")}
          onContextMenu={(e) => control && e.preventDefault()}
          onWheel={(e) => control && send({ kind: "wheel", ...at(e), dx: e.deltaX, dy: e.deltaY })}
          onKeyDown={key("down")}
          onKeyUp={key("up")}
          onPaste={paste}
        />
      </div>
      <p className="m-0 text-xs text-ink3">
        {control ? "You hold the browser. Seat actions are refused until you give it back." : "Watching. Seats ask you before each action."}
      </p>
      <ActionLog />
    </div>
  );
}

/** What seats did here, newest last. */
function ActionLog() {
  const { browser } = useConnection();
  const log = (browser?.log ?? []).slice(-8);
  if (!log.length) return null;
  return (
    <ul className="m-0 max-h-32 list-none overflow-y-auto rounded-lg bg-g2 p-2 text-xs">
      {log.map((entry) => (
        <li key={entry.id} className="flex gap-2 py-0.5">
          <span className="text-ink3">{new Date(entry.at).toLocaleTimeString()}</span>
          <span className="min-w-0 flex-1 truncate text-ink2">{entry.summary}</span>
          <span className={cn("shrink-0", entry.outcome === "denied" && "text-err", entry.outcome === "paused" && "text-warn", (entry.outcome === "ran" || entry.outcome === "allowed") && "text-ink3")}>
            {{ ran: "ran", allowed: "allowed", denied: "denied", paused: "refused, you hold it" }[entry.outcome]}
          </span>
        </li>
      ))}
    </ul>
  );
}
