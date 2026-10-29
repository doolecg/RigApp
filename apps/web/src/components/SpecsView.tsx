import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorView, basicSetup } from "codemirror";
import { Check, FileDiff, Save, X } from "lucide-react";
import { tags } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import type { Project, SpecFile } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

// Editor colours from the app's own tokens, so it follows the light and dark themes.
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--g0)", color: "var(--ink)", fontSize: "12.5px" },
  ".cm-content": { fontFamily: "'Cascadia Mono', Consolas, monospace", caretColor: "var(--acc)" },
  ".cm-gutters": { backgroundColor: "var(--g0)", color: "var(--ink3)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--g1)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--acc-soft)" },
  ".cm-changedLine": { backgroundColor: "var(--add)" },
  ".cm-deletedChunk": { backgroundColor: "var(--del)" },
});

// One accent for keys and headings, softer ink for values, the faintest for comments.
const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.propertyName, tags.definition(tags.propertyName), tags.keyword], color: "var(--acc)" },
    { tag: [tags.string, tags.number, tags.bool, tags.null], color: "var(--ink2)" },
    { tag: [tags.comment, tags.meta, tags.punctuation], color: "var(--ink3)" },
    { tag: tags.heading, color: "var(--acc)", fontWeight: "600" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "600" },
  ]),
);

type Check = { valid: boolean; errors: string[] } | null;

/**
 * The rig's spec and culture file in an editor. OpenRig's own validator checks the
 * spec, you see the change as a diff, and Save writes through OpenRig's files route.
 */
export function SpecsView({ project }: { project: Project }) {
  const [files, setFiles] = useState<SpecFile[] | null>(null);
  const [name, setName] = useState<SpecFile["name"]>("rig.yaml");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [check, setCheck] = useState<Check>(null);
  const [review, setReview] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const diffHost = useRef<HTMLDivElement>(null);

  const load = () =>
    void request({ method: "specs.load", rigId: project.id }).then((r) => {
      if (!r.ok) return setError(r.error ?? "RigApp could not load the spec.");
      setFiles(r.data as SpecFile[]);
      setError(null);
    });
  useEffect(load, [project.id]);

  const file = files?.find((f) => f.name === name) ?? files?.[0];
  const changed = !!file && draft !== file.content;

  // One editor per file and mode; the review mode shows the change against what is on disk.
  useEffect(() => {
    if (!file || !host.current) return;
    setDraft(file.content);
    setCheck(null);
    const view = new EditorView({
      parent: host.current,
      doc: file.content,
      extensions: [
        basicSetup,
        theme,
        highlight,
        file.name === "rig.yaml" ? yaml() : markdown(),
        EditorView.editable.of(file.editable),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => u.docChanged && setDraft(u.state.doc.toString())),
      ],
    });
    return () => view.destroy();
  }, [file]);

  useEffect(() => {
    if (!review || !file || !diffHost.current) return;
    const view = new EditorView({
      parent: diffHost.current,
      doc: draft,
      extensions: [basicSetup, theme, highlight, EditorView.editable.of(false), EditorView.lineWrapping, unifiedMergeView({ original: file.content, mergeControls: false })],
    });
    return () => view.destroy();
  }, [review]);

  const validate = async () => {
    const r = await request({ method: "specs.validate", content: draft });
    const result = (r.data as Check) ?? { valid: false, errors: [r.error ?? "OpenRig did not answer."] };
    setCheck(result);
    return result.valid;
  };

  const save = async () => {
    if (!file?.root || !file.path || !file.mtime || !file.hash) return;
    if (file.name === "rig.yaml" && !(await validate())) return;
    const r = await request({ method: "specs.save", rigId: project.id, root: file.root, path: file.path, content: draft, mtime: file.mtime, hash: file.hash });
    if (!r.ok) return setNote(r.error ?? "Saving failed.");
    setReview(false);
    setNote(
      project.status === "running"
        ? "Saved. The running rig picks it up the next time it starts: Rig down, then Rig up."
        : "Saved. It is used the next time the rig starts.",
    );
    load();
  };

  if (error) return <p className="m-auto max-w-md px-6 text-center text-err">{error}</p>;
  if (!files || !file) return <p className="m-auto text-ink2">Loading the spec</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2 py-2">
        <div className="flex gap-0.5 rounded-lg bg-g0 p-0.5" role="tablist">
          {files.map((f) => (
            <button
              key={f.name}
              role="tab"
              aria-selected={f.name === file.name}
              className={cn("rounded-md px-2.5 py-1 font-mono text-xs text-ink2", f.name === file.name && "bg-g3 text-ink")}
              onClick={() => {
                setName(f.name);
                setReview(false);
                setNote(null);
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
        {!file.editable && <span className="text-xs text-ink3">{file.reason}</span>}
        <span className="ml-auto" />
        {file.name === "rig.yaml" && (
          <Button variant="ghost" className="h-7" onClick={validate}>
            <Check />
            Validate
          </Button>
        )}
        {file.editable && (
          <>
            <Button variant="ghost" className="h-7" disabled={!changed} onClick={() => setReview(!review)}>
              <FileDiff />
              {review ? "Back to editing" : "Review changes"}
            </Button>
            <Button className="h-7" disabled={!changed} onClick={save}>
              <Save />
              Save
            </Button>
          </>
        )}
      </div>
      {check && (
        <div className={cn("mb-2 rounded-lg bg-g2 px-3 py-2 text-xs", check.valid ? "text-acc" : "text-err")}>
          {check.valid ? "OpenRig says this spec is valid." : check.errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}
      {note && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-g2 px-3 py-2 text-xs text-ink2">
          {note}
          <button className="ml-auto" aria-label="Dismiss" onClick={() => setNote(null)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div key={file.name} ref={host} className={cn("min-h-0 flex-1 overflow-hidden rounded-lg", review && "hidden")} />
      {review && <div ref={diffHost} className="min-h-0 flex-1 overflow-hidden rounded-lg" />}
    </div>
  );
}
