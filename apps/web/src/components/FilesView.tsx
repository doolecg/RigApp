import { ArrowLeft, File, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import type { FileEntry, Seat } from "@rigapp/contracts";
import { request } from "@/lib/connection";

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A read-only look at the seat's working folder. */
export function FilesView({ seat }: { seat: Seat }) {
  const [path, setPath] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    if (file) {
      setText(null);
      void request({ method: "files.read", session: seat.session, path: file }).then((r) => {
        if (!live) return;
        if (r.ok) setText(r.text ?? "");
        else setError(r.error ?? "RigApp could not read that file.");
      });
    } else {
      setFiles(null);
      void request({ method: "files.list", session: seat.session, path }).then((r) => {
        if (!live) return;
        if (r.ok) setFiles(r.files ?? []);
        else setError(r.error ?? "RigApp could not read that folder.");
      });
    }
    return () => {
      live = false;
    };
  }, [seat.session, path, file]);

  const parts = path.split("/").filter(Boolean);
  const up = () => (file ? setFile(null) : setPath(parts.slice(0, -1).join("/")));
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-1.5 pb-2 text-xs text-ink2">
        {(file || path) && (
          <button className="rounded p-0.5 hover:bg-g3" aria-label="Back" onClick={up}>
            <ArrowLeft className="size-3.5" />
          </button>
        )}
        <span className="truncate font-mono" title={seat.cwd ?? ""}>
          {file ?? (path || seat.cwd)}
        </span>
      </div>
      {error && <p className="m-0 text-xs text-err">{error}</p>}
      {file ? (
        text === null ? (
          !error && <p className="m-0 text-ink3">Loading</p>
        ) : (
          <pre className="m-0 overflow-auto rounded-md bg-g0 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap text-ink">{text}</pre>
        )
      ) : files === null ? (
        !error && <p className="m-0 text-ink3">Loading</p>
      ) : files.length === 0 ? (
        <p className="m-0 text-ink3">This folder is empty.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {files.map((entry) => {
            const next = [...parts, entry.name].join("/");
            const Icon = entry.dir ? Folder : File;
            return (
              <li key={entry.name}>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-g2"
                  onClick={() => (entry.dir ? setPath(next) : setFile(next))}
                >
                  <Icon className={entry.dir ? "size-3.5 text-acc" : "size-3.5 text-ink3"} />
                  <span className="truncate">{entry.name}</span>
                  {!entry.dir && <span className="ml-auto shrink-0 text-xs text-ink3">{size(entry.size)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
