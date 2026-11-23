import { useLayoutEffect, useRef, useState } from "react";
import type { GameBoyButton } from "../shared/gameplay";
import type { AgentLogEntry, AgentStatus } from "./useGameplayAgent";

const statusLabels: Record<AgentStatus, string> = {
  offline: "Offline",
  connecting: "Connecting",
  waiting: "Waiting for ROM",
  observing: "Choosing move",
  watching: "Watching the screen",
  moving: "Playing",
  retrying: "Waiting to retry",
  suspended: "Suspended",
  error: "Needs attention",
};

const buttonLabels: Record<GameBoyButton, string> = {
  up: "↑", down: "↓", left: "←", right: "→", a: "A", b: "B", start: "Start", select: "Select",
};

const resultLabels = {
  changed: "State changed",
  unchanged: "No change",
  revisited: "Returned to a recent state",
  stale: "State changed before input",
  blocked: "Already tried here",
};
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

type AgentPaneProps = {
  open: boolean;
  canConnect: boolean;
  status: AgentStatus;
  log: AgentLogEntry[];
  diagnostics: string;
  onConnect: () => void;
  onDisconnect: () => void;
};

type InputEntry = Extract<AgentLogEntry, { kind: "move" }>;

function Input({ entry }: { entry: InputEntry }) {
  const { move, result } = entry;
  return (
    <div className="agent-input mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10px]">
      {move.buttons.length ? move.buttons.map((button) => (
        <kbd key={button} className="agent-log-key keycap rounded px-1.5 leading-[1.25rem]">{buttonLabels[button]}</kbd>
      )) : <span>Wait</span>}
      <span>{move.frames} {move.frames === 1 ? "frame" : "frames"}</span>
      <span aria-hidden="true">·</span>
      <span>{resultLabels[result]}</span>
    </div>
  );
}

function LogRow({ entry, input }: { entry: AgentLogEntry; input?: InputEntry }) {
  const intent = entry.kind === "intent";
  return (
    <li className="agent-log-row min-w-0 px-2.5 py-2.5" data-kind={entry.kind}>
      <div className="agent-log-meta mb-1 flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums">
        <span title={intent ? "Decision round trip" : undefined}>
          {intent ? `${entry.modelName ?? "Decision"} · ${(entry.elapsedMs / 1_000).toFixed(1)}s` : null}
        </span>
        <time dateTime={new Date(entry.time).toISOString()}>{timeFormat.format(entry.time)}</time>
      </div>
      {entry.kind === "move" ? <Input entry={entry} /> : <p className="agent-log-text break-words">{entry.text}</p>}
      {input && <Input entry={input} />}
    </li>
  );
}

export default function AgentPane({ open, canConnect, status, log, diagnostics, onConnect, onDisconnect }: AgentPaneProps) {
  const list = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  const [copied, setCopied] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const linkOpen = status !== "offline" && status !== "error";

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopied(diagnostics);
      setShowDiagnostics(false);
    } catch {
      setShowDiagnostics(true);
    }
  }

  useLayoutEffect(() => {
    const viewport = list.current;
    if (viewport && followLog.current) viewport.scrollTop = viewport.scrollHeight;
  }, [log, open]);

  return (
    <aside
      id="agent-pane"
      hidden={!open}
      aria-label="Cloudflare Agent"
      className="agent-pane relative isolate min-h-0 min-w-0 flex-col rounded-2xl p-2.5 sm:rounded-3xl sm:p-3"
      onKeyDown={(event) => {
        if (event.key === "Enter") event.stopPropagation();
      }}
    >
      <div className="agent-link-controls flex flex-wrap items-center gap-x-2.5 gap-y-2 px-1.5 pt-1 pb-2.5">
        <button
          type="button"
          onClick={linkOpen ? onDisconnect : onConnect}
          data-linked={linkOpen}
          disabled={!linkOpen && !canConnect}
          className="agent-link-button cursor-pointer rounded-md px-2 py-1 font-mono text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default"
        >
          {linkOpen ? "Disconnect" : "Connect to Agent"}
        </button>
        <p className="agent-link-status flex items-center gap-1.5 font-mono text-[10px]">
          <span aria-hidden="true" className="agent-status-light" data-status={status} />
          {!linkOpen && !canConnect ? "Load a ROM to connect" : statusLabels[status]}
        </p>
        {!linkOpen && canConnect && (
          <p className="agent-connection-note w-full text-[10px]">Shares game frames with Workers AI</p>
        )}
        {diagnostics && (
          <button
            type="button"
            onClick={() => void copyDiagnostics()}
            className="agent-link-status ml-auto cursor-pointer rounded-sm font-mono text-[10px] underline underline-offset-2 focus-visible:outline-2"
          >
            {copied === diagnostics ? "Copied" : "Copy diagnostics"}
          </button>
        )}
        {showDiagnostics && (
          <textarea
            aria-label="Agent diagnostics"
            className="w-full rounded border border-stone-300 bg-white p-1.5 font-mono text-[10px] text-stone-700"
            readOnly
            rows={3}
            value={diagnostics}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => event.stopPropagation()}
          />
        )}
      </div>
      <div
        ref={list}
        tabIndex={0}
        role="log"
        aria-live="off"
        aria-label="Gameplay decisions"
        className="agent-log min-h-0 flex-1 overflow-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2"
        onKeyDown={(event) => event.stopPropagation()}
        onScroll={(event) => {
          const node = event.currentTarget;
          followLog.current = node.scrollHeight - node.scrollTop - node.clientHeight < 36;
        }}
      >
        {log.length ? (
          <ol>
            {log.map((entry, index) => {
              if (entry.kind === "move" && log[index - 1]?.kind === "intent") return null;
              const next = log[index + 1];
              return <LogRow key={entry.id} entry={entry} input={entry.kind === "intent" && next?.kind === "move" ? next : undefined} />;
            })}
          </ol>
        ) : (
          <p className="agent-empty px-2.5 py-3 font-mono text-[11px]">No decisions yet</p>
        )}
      </div>
    </aside>
  );
}
