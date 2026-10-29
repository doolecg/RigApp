import type { Tone } from "@/lib/seat";
import { cn } from "@/lib/utils";

const TONES: Record<Tone, string> = {
  acc: "bg-acc",
  warn: "bg-warn",
  err: "bg-err",
  idle: "bg-idle",
};

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", TONES[tone], className)} />;
}
