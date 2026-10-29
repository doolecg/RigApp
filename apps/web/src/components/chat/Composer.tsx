import { ArrowUp, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Project, Seat } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { seatState } from "@/lib/seat";
import { cn } from "@/lib/utils";
import { StatusDot } from "../StatusDot";
import { Button } from "../ui/button";

interface Command {
  name: "stop" | "approve" | "deny";
  label: string;
}

const COMMANDS: Command[] = [
  { name: "stop", label: "Stop the seat's current turn (presses Esc)" },
  { name: "approve", label: "Approve the prompt it is waiting on (presses Enter)" },
  { name: "deny", label: "Deny the prompt it is waiting on (presses Esc)" },
];

type Option = { kind: "seat"; seat: Seat } | { kind: "command"; command: Command };

/** What the text before the cursor asks for: a seat after `@`, or a `/` command. */
function trigger(text: string, cursor: number): { kind: "seat" | "command"; query: string; start: number } | null {
  const before = text.slice(0, cursor);
  const at = /(^|\s)@([\w.-]*)$/.exec(before);
  if (at) return { kind: "seat", query: at[2]!.toLowerCase(), start: before.length - at[2]!.length - 1 };
  const slash = /^\/(\w*)$/.exec(before);
  if (slash) return { kind: "command", query: slash[1]!.toLowerCase(), start: 0 };
  return null;
}

/**
 * Type to the seat this thread shows, or pick another with `@`. Enter sends through
 * OpenRig; Shift+Enter starts a new line. `/` lists actions.
 */
export function Composer({ project, seat }: { project: Project; seat: Seat }) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [target, setTarget] = useState(seat.session);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<{ message: string; canForce: boolean } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const seats = project.pods.flatMap((pod) => pod.seats);
  const to = seats.find((s) => s.session === target) ?? seat;
  const found = trigger(text, cursor);
  const options: Option[] =
    found?.kind === "seat"
      ? seats.filter((s) => s.logicalId.toLowerCase().includes(found.query)).map((s) => ({ kind: "seat", seat: s }))
      : found?.kind === "command"
        ? COMMANDS.filter((c) => c.name.startsWith(found.query)).map((c) => ({ kind: "command", command: c }))
        : [];

  useEffect(() => setActive(0), [found?.kind, found?.query]);
  // Grow with the text, up to about ten lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const key = async (name: Command["name"]) => {
    const result = await request({ method: "seat.key", session: to.session, key: name });
    setProblem(result.ok ? null : { message: result.error ?? "That did not work.", canForce: false });
  };

  const choose = (option: Option) => {
    if (!found) return;
    if (option.kind === "seat") {
      setTarget(option.seat.session);
      setText(text.slice(0, found.start) + text.slice(cursor));
    } else {
      setText("");
      void key(option.command.name);
    }
    box.current?.focus();
  };

  const submit = async (force = false) => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    const result = await request({ method: "seat.send", session: to.session, text: message, force });
    setSending(false);
    if (result.ok) {
      setText("");
      setProblem(null);
    } else {
      setProblem({ message: result.error ?? "OpenRig did not take the message.", canForce: result.reason === "mid_work" });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((active + step + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(options[active]!);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const working = to.activity === "running";
  const stopped = to.status !== "running";
  return (
    <div className="mx-auto w-full max-w-[760px] px-3 pb-3 sm:px-6 sm:pb-4">
      {problem && (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-g2 px-3 py-2 text-xs">
          <span className="text-err">{problem.message}</span>
          {problem.canForce && (
            <Button variant="ghost" className="h-7" onClick={() => submit(true)}>
              Send anyway
            </Button>
          )}
          <Button variant="ghost" size="icon" className="ml-auto" aria-label="Dismiss" onClick={() => setProblem(null)}>
            <X />
          </Button>
        </div>
      )}
      <div className="relative rounded-xl bg-g2">
        {options.length > 0 && (
          <ul role="listbox" className="absolute right-0 bottom-full left-0 mb-2 max-h-64 overflow-y-auto rounded-lg bg-g3 p-1">
            {options.map((option, i) => (
              <li
                key={option.kind === "seat" ? option.seat.session : option.command.name}
                role="option"
                aria-selected={i === active}
                className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5", i === active && "bg-g4")}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                {option.kind === "seat" ? (
                  <>
                    <StatusDot tone={seatState(option.seat).tone} />
                    <span>{option.seat.logicalId}</span>
                    <span className="ml-auto text-xs text-ink3">{option.seat.harness}</span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold">/{option.command.name}</span>
                    <span className="text-xs text-ink2">{option.command.label}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-1.5 px-3.5 pt-2.5 text-xs text-ink3">
          To <span className="font-semibold text-ink">{to.logicalId}</span>
          {project.lead === to.session && <span>(lead)</span>}
          {to.session !== seat.session && (
            <button className="text-acc" onClick={() => setTarget(seat.session)}>
              back to {seat.logicalId}
            </button>
          )}
        </div>
        <textarea
          ref={box}
          rows={1}
          value={text}
          placeholder={stopped ? `${to.logicalId} is stopped, so it can't take messages.` : `Message ${to.logicalId}`}
          aria-label={`Message ${to.logicalId}`}
          className="block w-full resize-none bg-transparent px-3.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink3"
          onChange={(event) => {
            setText(event.target.value);
            setCursor(event.target.selectionStart);
          }}
          onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <div className="flex items-center gap-2 px-3 pb-2.5">
          <span className="truncate text-xs text-ink3">@ picks a seat · / for actions · Enter sends · Shift+Enter new line</span>
          <span className="ml-auto" />
          {working && (
            <Button variant="ghost" className="bg-g3" onClick={() => key("stop")}>
              <Square className="fill-current" />
              Stop
            </Button>
          )}
          <Button size="icon" aria-label="Send" disabled={!text.trim() || sending || stopped} onClick={() => submit()}>
            <ArrowUp />
          </Button>
        </div>
      </div>
    </div>
  );
}
