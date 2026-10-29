import { Check, Copy, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import type { SetupCheck, Shell } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { Button } from "./ui/button";

interface Step {
  text: string;
  command?: string;
}

/** The exact steps for whatever failed. RigApp never runs these itself. */
function stepsFor(shell: Shell): Step[] {
  const failed = (id: SetupCheck["id"]) => shell.checks.some((c) => c.id === id && !c.ok);
  const windows = shell.platform === "windows";
  const steps: Step[] = [];
  if (failed("wsl")) {
    steps.push(
      { text: "Open PowerShell as administrator and install WSL2 with Ubuntu:", command: "wsl --install -d Ubuntu" },
      { text: "Restart Windows, then open Ubuntu from the Start menu and make a user." },
    );
  } else {
    steps.push({ text: windows ? "Open Ubuntu from the Start menu." : "Open a terminal." });
  }
  if (failed("tmux")) steps.push({ text: "Install tmux:", command: "sudo apt install -y tmux" });
  if (failed("rig")) {
    steps.push({
      text: windows
        ? "Install OpenRig with Linux Node 22 or 24 (not the Windows one):"
        : "Install OpenRig (needs Node 22 or 24):",
      command: "npm install -g @openrig/cli",
    });
  }
  if (failed("daemon")) steps.push({ text: "Start the daemon:", command: "rig daemon start" });
  steps.push({ text: "Come back here and press Check again." });
  return steps;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Copy command"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

export function SetupScreen({ shell }: { shell: Shell }) {
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    try {
      await request("setup.recheck");
    } finally {
      setChecking(false);
    }
  };
  return (
    <main className="h-full overflow-y-auto bg-g1">
      <div className="mx-auto max-w-[600px] px-6 py-16">
        <h1 className="m-0 text-2xl font-semibold">RigApp can't reach OpenRig yet</h1>
        <p className="mt-2 text-sm text-ink2">
          RigApp drives the OpenRig daemon.
          {shell.platform === "windows" && " On Windows the daemon runs inside WSL2 because it needs tmux."} RigApp
          never installs anything for you; follow the steps, then press Check again.
        </p>
        <ul className="mt-6 overflow-hidden rounded-lg bg-g2">
          {shell.checks.map((check) => (
            <li key={check.id} className="grid grid-cols-[20px_180px_1fr] items-center gap-3 px-4 py-2.5 even:bg-g3/40">
              {check.ok ? <Check className="size-4 text-acc" /> : <X className="size-4 text-err" />}
              <span className="font-semibold">{check.label}</span>
              <span className="text-ink2">{check.detail}</span>
            </li>
          ))}
        </ul>
        <ol className="mt-6 space-y-4">
          {stepsFor(shell).map((step, i) => (
            <li key={step.text} className="grid grid-cols-[22px_1fr] gap-3">
              <span className="grid size-[22px] place-items-center rounded-full bg-g3 text-xs">{i + 1}</span>
              <div>
                <p className="m-0 pt-0.5">{step.text}</p>
                {step.command && (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-g0 py-2 pr-2 pl-3">
                    <code className="font-mono text-xs">{step.command}</code>
                    <CopyButton text={step.command} />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        <Button className="mt-8" onClick={recheck} disabled={checking}>
          <RefreshCw className={checking ? "animate-spin" : undefined} />
          {checking ? "Checking" : "Check again"}
        </Button>
      </div>
    </main>
  );
}
