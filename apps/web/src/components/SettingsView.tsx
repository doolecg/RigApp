import { RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import type { DesktopBridge, Settings, Shell, UpdateState } from "@rigapp/contracts";
import { request } from "@/lib/connection";
import { bindings, COMMANDS, comboOf, label, type CommandId } from "@/lib/keys";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

declare global {
  interface Window {
    rigapp?: DesktopBridge;
  }
}

const NOTICE =
  'RigApp is provided "as is", without warranty, under the MIT licence. To the extent permitted by law, the authors are not liable for any loss or damage from using it. Back up your work.';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="m-0 mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const save = (patch: Partial<Settings>) => void request({ method: "settings.set", patch });

/** The desktop app's updater, while RigApp runs inside it. */
export function useUpdate(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    const bridge = window.rigapp;
    if (!bridge) return;
    void bridge.getUpdate().then(setState);
    return bridge.onUpdate(setState);
  }, []);
  return state;
}

function Updates({ state }: { state: UpdateState }) {
  const bridge = window.rigapp!;
  const words: Record<UpdateState["status"], string> = {
    idle: "Not checked yet.",
    checking: "Checking GitHub for a newer version.",
    none: "You have the newest version.",
    downloading: `Downloading version ${state.version ?? ""}${state.percent != null ? ` (${Math.round(state.percent)}%)` : ""}.`,
    ready: `Version ${state.version} is ready to install.`,
    error: `The check failed: ${state.error ?? "unknown error"}.`,
  };
  return (
    <>
      <p className="mt-0 text-ink2">{words[state.status]}</p>
      <div className="flex gap-2">
        <Button variant="ghost" className="bg-g3" disabled={state.status === "checking"} onClick={() => void bridge.checkForUpdates()}>
          <RefreshCw />
          Check for updates
        </Button>
        {state.status === "ready" && <Button onClick={() => bridge.installUpdate()}>Restart and install</Button>}
      </div>
      {state.notes && (
        <div className="md mt-3 rounded-lg bg-g2 px-4 py-3">
          <Markdown>{state.notes}</Markdown>
        </div>
      )}
    </>
  );
}

/** Every option RigApp has, applied as soon as you change it. */
export function SettingsView({ shell }: { shell: Shell }) {
  const { settings } = shell;
  const [address, setAddress] = useState(settings.daemonUrl);
  const [recording, setRecording] = useState<CommandId | null>(null);
  const update = useUpdate();
  const keys = bindings(settings);

  // While recording, the next key combination becomes the shortcut; Esc cancels.
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return setRecording(null);
      const combo = comboOf(event);
      if (!combo) return;
      save({ keybindings: { [recording]: combo } });
      setRecording(null);
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [recording]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-4 py-8 sm:px-8">
        <h1 className="m-0 text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-ink2">Changes apply straight away and are saved.</p>

        <Section title="Appearance">
          <div className="flex gap-1" role="radiogroup" aria-label="Theme">
            {(["system", "dark", "light"] as const).map((theme) => (
              <button
                key={theme}
                role="radio"
                aria-checked={settings.theme === theme}
                className={cn("rounded-md px-3 py-1.5 text-ink2 hover:text-ink", settings.theme === theme && "bg-g3 text-ink")}
                onClick={() => save({ theme })}
              >
                {theme === "system" ? "Same as the system" : theme === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </Section>

        <Section title="OpenRig">
          <p className="mt-0 text-ink2">
            Connected to {shell.daemon.url} ({shell.daemon.host}). Leave the address empty to let RigApp find the daemon itself.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save({ daemonUrl: address.trim().replace(/\/$/, "") });
            }}
          >
            <input
              aria-label="Daemon address"
              placeholder="http://127.0.0.1:7433"
              className="flex-1 rounded-md bg-g2 px-2.5 py-1.5 text-ink outline-none focus:outline-acc"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <Button type="submit" disabled={address.trim() === settings.daemonUrl}>
              Use this address
            </Button>
          </form>
        </Section>

        <Section title="Tools">
          <p className="mt-0 text-ink2">
            These panels are for you. They add nothing to any seat's context, so they cost no seat tokens. Each one talks only to a tool on
            this computer.
          </p>
          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={settings.tools.hindsight}
              onChange={(e) => save({ tools: { ...settings.tools, hindsight: e.target.checked } })}
            />
            Memory panel: search a project's Hindsight memory
          </label>
          {settings.tools.hindsight && (
            <input
              aria-label="Hindsight address"
              className="mb-1 ml-6 w-72 rounded-md bg-g2 px-2.5 py-1 text-ink outline-none focus:outline-acc"
              defaultValue={settings.tools.hindsightUrl}
              onBlur={(e) => e.target.value.trim() && save({ tools: { ...settings.tools, hindsightUrl: e.target.value.trim() } })}
            />
          )}
          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={settings.tools.codegraph}
              onChange={(e) => save({ tools: { ...settings.tools, codegraph: e.target.checked } })}
            />
            Code panel: ask CodeGraph about the code in a seat's folder
          </label>
        </Section>

        <Section title="Keyboard shortcuts">
          <ul className="m-0 list-none p-0">
            {COMMANDS.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 even:bg-g2/60">
                <span className="flex-1">{c.label}</span>
                <button
                  className={cn("min-w-28 rounded-md bg-g3 px-2.5 py-1 font-mono text-xs", recording === c.id && "bg-acc-soft text-acc")}
                  onClick={() => setRecording(recording === c.id ? null : c.id)}
                  aria-label={`Change the shortcut for ${c.label}`}
                >
                  {recording === c.id ? "Press keys" : label(keys[c.id])}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Reset ${c.label}`}
                  disabled={(settings.keybindings[c.id] ?? c.key) === c.key}
                  onClick={() => save({ keybindings: { [c.id]: c.key } })}
                >
                  <RotateCcw />
                </Button>
              </li>
            ))}
          </ul>
        </Section>

        {update && (
          <Section title="Updates">
            <Updates state={update} />
          </Section>
        )}

        <Section title="About">
          <p className="mt-0">RigApp {shell.version}</p>
          <p className="text-ink2">{NOTICE}</p>
          <p className="text-ink2">
            Modelled on T3 Code and Claude Code Projects, and driven by OpenRig. Not affiliated with or endorsed by Anthropic, OpenRig or T3
            Tools. AI output can be wrong; check it before relying on it.
          </p>
          <p className="mb-0 text-ink2">
            RigApp talks only to the OpenRig daemon on your machine{settings.tools.hindsight ? ", to Hindsight" : ""}
            {update ? " and, to look for updates, to GitHub" : ""}.
          </p>
        </Section>
      </div>
    </div>
  );
}
