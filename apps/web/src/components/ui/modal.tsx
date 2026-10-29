import { useEffect, type ReactNode } from "react";

/** A plain centred dialog: Esc or a click outside closes it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-[min(560px,100%)] overflow-y-auto rounded-xl bg-g2 p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="m-0 mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
