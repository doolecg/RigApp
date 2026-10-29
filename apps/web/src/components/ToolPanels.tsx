import { Search } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { Project, Seat } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { useStored } from "@/lib/ui";
import { SeatMemory } from "./SeatMemory";

function SearchBox({ placeholder, busy, onSearch }: { placeholder: string; busy: boolean; onSearch: (q: string) => void }) {
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim()) onSearch(query.trim());
  };
  return (
    <form onSubmit={submit} className="mb-3 flex items-center gap-2 rounded-md bg-g2 px-2.5">
      <Search className="size-3.5 shrink-0 text-ink3" />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        className="w-full bg-transparent py-1.5 text-ink outline-none placeholder:text-ink3"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
      />
    </form>
  );
}

/** What this project's Hindsight memory holds, searched by meaning. For you; seats get nothing from it. */
export function MemoryPanel({ project }: { project: Project }) {
  const [banks, setBanks] = useState<string[] | null>(null);
  const [bank, setBank] = useStored<string>(`rigapp.bank.${project.id}`, "");
  const [results, setResults] = useState<{ id: string; text: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void request({ method: "tools.banks" }).then((r) => {
      if (!r.ok) return setError(r.error ?? "Hindsight did not answer.");
      const list = r.data as string[];
      setBanks(list);
      // Guess the bank from the folder the seats work in, as Hindsight names banks after repos.
      if (!bank) {
        const folder = project.pods[0]?.seats[0]?.cwd?.split("/").pop()?.toLowerCase() ?? "";
        setBank(list.find((b) => b.toLowerCase().endsWith(`::${folder}`)) ?? list[0] ?? "");
      }
    });
  }, [project.id]);

  const search = async (query: string) => {
    setBusy(true);
    const r = await request({ method: "tools.recall", bank, query });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Hindsight did not answer.");
    setError(null);
    setResults(r.data as { id: string; text: string }[]);
  };

  if (error && !banks) return <p className="m-0 text-xs text-err">{error}</p>;
  return (
    <div>
      <select
        aria-label="Memory bank"
        className="mb-2 w-full rounded-md bg-g2 px-2 py-1.5 text-ink"
        value={bank}
        onChange={(e) => {
          setBank(e.target.value);
          setResults(null);
        }}
      >
        {(banks ?? []).map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      <SearchBox placeholder="Search what this project remembers" busy={busy || !bank} onSearch={search} />
      {busy && <p className="m-0 text-ink3">Searching</p>}
      {error && <p className="m-0 text-xs text-err">{error}</p>}
      {results?.length === 0 && <p className="m-0 text-ink3">Nothing found.</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {results?.map((r) => (
          <li key={r.id} className="rounded-md bg-g2 px-3 py-2 text-xs leading-relaxed text-ink2">
            {r.text}
          </li>
        ))}
      </ul>
      <SeatMemory project={project} bank={bank} />
    </div>
  );
}

/** CodeGraph's view of the code in the seat's folder: a symbol or question, its source and callers. */
export function CodePanel({ seat }: { seat: Seat }) {
  const [answer, setAnswer] = useState<{ folder: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = async (query: string) => {
    setBusy(true);
    const r = await request({ method: "tools.explore", session: seat.session, query });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "CodeGraph did not answer.");
    setError(null);
    setAnswer(r.data as { folder: string; text: string });
  };
  return (
    <div>
      <SearchBox placeholder="A symbol, file or question" busy={busy} onSearch={search} />
      {busy && <p className="m-0 text-ink3">Asking CodeGraph</p>}
      {error && <p className="m-0 text-xs text-err">{error}</p>}
      {answer && (
        <>
          <p className="mt-0 mb-1.5 truncate font-mono text-xs text-ink3" title={answer.folder}>
            {answer.folder}
          </p>
          <pre className="m-0 max-h-[70vh] overflow-auto rounded-md bg-g0 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-ink">
            {answer.text || "CodeGraph found nothing. The folder may have no .codegraph index."}
          </pre>
        </>
      )}
    </div>
  );
}
