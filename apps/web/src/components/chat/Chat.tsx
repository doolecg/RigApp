import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatItem, Seat } from "@rigapp/contracts";
import { useConnection, watchThread } from "@/lib/connection";
import { seatState } from "@/lib/seat";
import { StatusDot } from "../StatusDot";
import { ToolCard } from "./ToolCard";

// OpenRig's startup notes and long pasted messages are folded past this length.
const USER_FOLD = 500;

function Centered({ children }: { children: ReactNode }) {
  return <p className="m-auto max-w-sm px-6 text-center text-ink2">{children}</p>;
}

function UserRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > USER_FOLD;
  return (
    <div className="rounded-lg bg-g2 px-3.5 py-2.5 whitespace-pre-wrap break-words">
      {long && !open ? `${text.slice(0, USER_FOLD).trimEnd()}…` : text}
      {long && (
        <button className="mt-1 block text-xs text-acc" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="md break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {text}
      </Markdown>
    </div>
  );
}

function Row({ item }: { item: ChatItem }) {
  if (item.kind === "user") return <UserRow text={item.text} />;
  if (item.kind === "assistant") return <AssistantText text={item.text} />;
  return <ToolCard item={item} />;
}

/** The seat's conversation, read from its harness session file and kept live by the server. */
export function Chat({ seat }: { seat: Seat }) {
  const thread = useConnection().threads[seat.session];
  const scroller = useRef<HTMLDivElement>(null);
  // Follow new messages only while you are already at the bottom.
  const pinned = useRef(true);

  useEffect(() => watchThread(seat.session), [seat.session]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [thread?.items]);

  if (!thread) return <Centered>Loading the chat</Centered>;
  if (thread.unavailable) return <Centered>{thread.unavailable}</Centered>;
  if (thread.items.length === 0) return <Centered>No messages in this seat yet.</Centered>;

  const state = seatState(seat);
  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => {
        const el = event.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      <div className="mx-auto flex max-w-[760px] flex-col gap-2.5 px-4 py-4 sm:px-6">
        {thread.items.map((item, i) => {
          const previous = thread.items[i - 1];
          // Name the seat at the start of each of its turns.
          const turn = item.kind !== "user" && (!previous || previous.kind === "user");
          return (
            <div key={item.id} className={turn ? "mt-2" : undefined}>
              {turn && (
                <div className="mb-1.5 flex items-center gap-1.5 text-xs">
                  <StatusDot tone={state.tone} />
                  <span className="font-semibold text-ink">{seat.logicalId}</span>
                  <span className="text-ink3">· {seat.harness}</span>
                </div>
              )}
              <Row item={item} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
