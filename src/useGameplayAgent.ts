import type { MgbaPlay } from "@wasm-gaming/mgba-wasm";
import { AgentClient, type AgentConnectionError } from "agents/client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  attemptHistorySize, gameplayModel, gameplayModelName, inferenceTimeoutMs, isDecision, maxHoldFrames, maxWaitFrames,
  moveHistorySize, slowDecisionMs,
  type DecisionMessage, type DecisionReply, type DecisionStartedMessage, type DecisionTiming,
  type GameBoyButton, type HistoryEntry, type Move, type Observation, type ObserveMessage, type Turn,
} from "../shared/gameplay";
import { frameReader, pollScreen, sameSituation, staleFrame, waitForFrames, type GameFrame } from "./agentEmulator";
import type { GameBoyControlsHandle } from "./GameBoyControls";

type LogEntry =
  | { kind: "link" | "error" | "feedback"; text: string }
  | { kind: "intent"; text: string; elapsedMs: number; modelName?: string }
  | { kind: "move"; move: Move; result: Turn["result"] };

export type AgentLogEntry = LogEntry & { id: number; time: number };
type AgentActivity = "observing" | "moving" | "retrying" | "watching";
export type AgentStatus = AgentActivity | "offline" | "connecting" | "waiting" | "suspended" | "error";

type Emulator = {
  game: MgbaPlay | null;
  title: string;
  screen: RefObject<HTMLCanvasElement | null>;
  controls: RefObject<GameBoyControlsHandle | null>;
  blocked: boolean;
};

const logLimit = 64;
const diagnosticLimit = 16;
const stallLimit = 3;
const retryLimit = 3;
const pendingTimeoutMs = 10_000;
const inputSettleFrames = 90;

function sameButtons(a: GameBoyButton[], b: GameBoyButton[]) {
  return a.length === b.length && a.every((button) => b.includes(button));
}

type DecisionTrace = {
  requestId: string;
  browserMs: number;
  acceptedMs?: number;
  worker?: DecisionTiming;
  transport?: "reply-timeout" | "send-failed";
};

type Diagnostic = Partial<DecisionTrace> & {
  event: string;
  attempt?: number;
  code?: number;
  phase?: AgentActivity;
};

function requestDecision(agent: AgentClient, observation: Observation, signal: AbortSignal) {
  signal.throwIfAborted();
  const packet: ObserveMessage = { type: "observe", id: crypto.randomUUID(), observation };
  const startedAt = performance.now();
  let acceptedMs: number | undefined;
  return new Promise<{ reply: DecisionReply; trace: DecisionTrace }>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      finish({ retryAfterMs: 1_000, reason: "timeout" }, undefined, "reply-timeout");
    }, inferenceTimeoutMs + 2_000);

    function finish(reply: DecisionReply, worker?: DecisionTiming, transport?: DecisionTrace["transport"]) {
      cleanup();
      resolve({ reply, trace: {
        requestId: packet.id, browserMs: Math.round(performance.now() - startedAt), acceptedMs, worker, transport,
      } });
    }

    function cleanup() {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      agent.removeEventListener("message", receive);
    }

    function abort() {
      cleanup();
      reject(signal.reason);
    }

    function receive(event: MessageEvent) {
      if (typeof event.data !== "string") return;
      let response: Partial<DecisionMessage | DecisionStartedMessage> | null;
      try {
        response = JSON.parse(event.data);
      } catch {
        return;
      }
      if (response?.id !== packet.id) return;
      if (response.type === "decision-started") acceptedMs ??= Math.round(performance.now() - startedAt);
      if (response.type === "decision" && response.reply) finish(response.reply, response.timing);
    }

    signal.addEventListener("abort", abort, { once: true });
    agent.addEventListener("message", receive);
    try {
      agent.send(JSON.stringify(packet));
    } catch {
      finish({ error: "inference-failed" }, undefined, "send-failed");
    }
  });
}

function wait(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() {
      window.clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function useGameplayAgent({ game, title, screen, controls, blocked }: Emulator) {
  const link = useRef<{ client: AgentClient; timeout: number; connected: boolean } | null>(null);
  const sessionId = useRef<string | null>(null);
  const round = useRef<AbortController | null>(null);
  const nextLogId = useRef(0);
  const [client, setClient] = useState<AgentClient | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [failure, setFailure] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [activity, setActivity] = useState<AgentActivity>("observing");
  const [inputPulse, setInputPulse] = useState(0);
  const [log, setLog] = useState<AgentLogEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  const report = useCallback((diagnostic: Diagnostic) => {
    const event = { time: new Date().toISOString(), model: gameplayModel, ...diagnostic };
    console.warn("gameplay_diagnostic", event);
    setDiagnostics((current) => [...current.slice(1 - diagnosticLimit), JSON.stringify(event)]);
  }, []);

  const append = useCallback((event: LogEntry) => {
    const entry = { ...event, time: Date.now(), id: ++nextLogId.current };
    setLog((current) => [...current.slice(1 - logLimit), entry]);
  }, []);

  const stopRound = useCallback(() => round.current?.abort(), []);

  const closeLink = useCallback((event: LogEntry) => {
    const connection = link.current;
    if (!connection) return;
    link.current = null;
    window.clearTimeout(connection.timeout);
    stopRound();
    connection.client.close();
    setClient(null);
    setConnecting(false);
    setFailure(event.kind === "error");
    append(event);
  }, [append, stopRound]);

  function connect() {
    if (!game || blocked || link.current) return;
    sessionId.current ??= crypto.randomUUID();
    setConnecting(true);
    setFailure(false);
    const startedAt = performance.now();
    const connectionFailed = (error?: AgentConnectionError) => {
      if (link.current?.client === socket) {
        report({
          event: error ? "socket-closed" : "connect-timeout",
          browserMs: Math.round(performance.now() - startedAt),
          code: error?.code,
        });
        closeLink({
          kind: "error",
          text: link.current.connected ? "Agent connection lost." : "Couldn’t reach the local agent.",
        });
      }
    };
    const socket: AgentClient = new AgentClient({
      agent: "gameplay-agent",
      name: sessionId.current,
      host: window.location.host,
      protocol: window.location.protocol === "https:" ? "wss" : "ws",
      maxRetries: 0,
      onIdentity() {
        if (link.current?.client !== socket) return;
        window.clearTimeout(link.current.timeout);
        link.current.connected = true;
        setClient(socket);
        setConnecting(false);
        append({ kind: "link", text: "Connected to the gameplay agent." });
      },
      onConnectionError: connectionFailed,
    });
    link.current = { client: socket, timeout: window.setTimeout(() => connectionFailed(), 8_000), connected: false };
  }

  const disconnect = () => closeLink({ kind: "link", text: "Disconnected from the agent." });
  const takeOver = () => closeLink({ kind: "link", text: "Manual controls took over." });

  useEffect(() => {
    function onVisibility() {
      if (document.hidden) stopRound();
      setVisible(!document.hidden);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      const connection = link.current;
      link.current = null;
      if (connection) {
        window.clearTimeout(connection.timeout);
        connection.client.close();
      }
    };
  }, [stopRound]);

  useEffect(() => {
    const canvas = screen.current;
    const pad = controls.current;
    if (!client || !game || !canvas || !pad || blocked || !visible) return;
    const emulator = game;
    const display = canvas;
    const buttons = pad;
    const agent = client;
    const controller = new AbortController();
    const { signal } = controller;
    round.current = controller;

    function release() {
      buttons.setAgentButtons([]);
    }
    signal.addEventListener("abort", release, { once: true });

    async function play() {
      let phase: AgentActivity = "observing";
      let lastTrace: DecisionTrace | undefined;
      function showActivity(next: AgentActivity) {
        phase = next;
        setActivity(next);
      }

      try {
        const reader = frameReader(display);
        const history: HistoryEntry[] = [];
        const screens: { id: number; frame: GameFrame }[] = [];
        const attempts: { from: number; to: number; buttons: GameBoyButton[]; progressed: boolean }[] = [];
        let nextScreen = 0;
        let waits = 0;
        let stalled = 0;
        let invalidDecisions = 0;
        let retries = 0;
        let pendingSince: number | undefined;

        function identifyScreen(frame: GameFrame) {
          const previous = screens.findLast((screen) => sameSituation(screen.frame, frame));
          if (previous) return { id: previous.id, isNew: false };
          const id = ++nextScreen;
          screens.push({ id, frame });
          if (screens.length > moveHistorySize * 2 + 2) screens.shift();
          return { id, isNew: true };
        }

        function failedButtons(screenId: number) {
          return attempts.filter(({ from, progressed }) => from === screenId && !progressed)
            .map(({ buttons }) => buttons);
        }

        function remember(turn: Turn, progressed: boolean) {
          const hasInput = turn.move.buttons.length > 0;
          if (!hasInput) waits++;
          else if (turn.result !== "stale" && turn.result !== "blocked") {
            if (waits) history.push(`WAITED ${waits} TIMES`);
            history.push(turn);
            waits = 0;
            if (history.filter((entry) => typeof entry !== "string").length > moveHistorySize) {
              history.splice(0, typeof history[0] === "string" ? 2 : 1);
            }
          }
          if (progressed) stalled = 0;
          else if (hasInput && ++stalled >= stallLimit) {
            throw new Error("Agent stopped after three button decisions without progress.");
          }
        }

        showActivity("observing");
        await waitForFrames(emulator, 1, signal);

        while (!signal.aborted) {
          showActivity("observing");
          const observed = reader.sample();
          const observedScreen = identifyScreen(observed).id;
          const observation: Observation = {
            image: reader.image(),
            title,
            screen: observedScreen,
            history: waits ? [...history, `WAITED ${waits} TIMES`] : history,
            blocked: failedButtons(observedScreen),
          };
          const { reply, trace } = await requestDecision(agent, observation, signal);
          signal.throwIfAborted();
          lastTrace = trace;

          if ("retryAfterMs" in reply) {
            if (reply.reason === "pending") {
              showActivity("retrying");
              if (pendingSince === undefined) report({ event: "waiting-for-previous-inference", ...trace });
              pendingSince ??= performance.now();
              if (performance.now() - pendingSince >= pendingTimeoutMs) {
                throw new Error("The previous model request is still running. Agent stopped to avoid overlapping calls.");
              }
              await wait(reply.retryAfterMs, signal);
              continue;
            }
            pendingSince = undefined;
            if (reply.reason) {
              showActivity("retrying");
              const reason = trace.transport === "reply-timeout" ? "No reply from the agent."
                : reply.reason === "timeout" ? "Workers AI decision timed out." : "Workers AI is busy.";
              report({ event: reply.reason, attempt: ++retries, ...trace });
              if (retries >= retryLimit) throw new Error(`${reason} Agent stopped after ${retryLimit} attempts.`);
              append({ kind: "feedback", text: `${reason} Retrying with a fresh frame.` });
            }
            await wait(reply.retryAfterMs * 2 ** Math.max(0, retries - 1), signal);
            continue;
          }
          pendingSince = undefined;
          retries = 0;
          if ("error" in reply || !isDecision(reply.decision)) {
            report({ event: "error" in reply ? reply.error : "invalid-decision", ...trace });
            if (trace.transport === "send-failed") throw new Error("Couldn’t send a frame to the agent.");
            if ("error" in reply && reply.error === "inference-failed") {
              throw new Error("Workers AI couldn’t complete the decision.");
            }
            if (++invalidDecisions < 2) continue;
            throw new Error("The agent couldn’t produce valid controls.");
          }
          invalidDecisions = 0;
          if (trace.browserMs >= slowDecisionMs) report({ event: "slow-decision", ...trace });

          const { move, intent } = reply.decision;
          const hasInput = move.buttons.length > 0;
          const before = hasInput ? reader.sample() : observed;
          if (hasInput && staleFrame(observed, before)) {
            append({ kind: "feedback", text: "Skipped an input because the game state changed." });
            remember({ intent, move, result: "stale" }, true);
            continue;
          }
          const from = hasInput ? identifyScreen(before).id : observedScreen;
          if (hasInput && failedButtons(from).some((tried) => sameButtons(tried, move.buttons))) {
            append({ kind: "feedback", text: "Skipped an input that already failed to make progress here." });
            remember({ intent, move, result: "blocked" }, false);
            continue;
          }
          signal.throwIfAborted();
          append({ kind: "intent", text: intent, elapsedMs: trace.browserMs, modelName: trace.worker && gameplayModelName });
          let heldFrames = 0;
          if (hasInput) {
            showActivity("moving");
            buttons.setAgentButtons(move.buttons);
            setInputPulse((count) => count + 1);
            heldFrames = await waitForFrames(emulator, move.frames, signal);
            signal.throwIfAborted();
            release();
          }
          showActivity("watching");
          const { frame: after, frames: polledFrames } = await pollScreen(
            emulator, reader.sample, before, hasInput ? inputSettleFrames : move.frames, signal,
          );
          signal.throwIfAborted();
          const frames = hasInput ? heldFrames : polledFrames;
          const { id: to, isNew } = identifyScreen(after);
          const result = from === to ? "unchanged" : isNew ? "changed" : "revisited";
          const progressed = hasInput
            ? from !== to && !attempts.some((attempt) => attempt.from === from && attempt.to === to)
            : result === "changed";
          if (hasInput) {
            attempts.push({ from, to, buttons: move.buttons, progressed });
            if (attempts.length > attemptHistorySize) attempts.shift();
          }
          append({ kind: "move", move: { buttons: move.buttons, frames }, result });
          remember({
            intent,
            move: { buttons: move.buttons, frames: Math.min(frames, hasInput ? maxHoldFrames : maxWaitFrames) },
            result,
            screens: { from, to },
          }, progressed);
        }
      } catch (error) {
        if (!signal.aborted) {
          report({ event: "gameplay-stopped", phase, ...lastTrace });
          closeLink({
            kind: "error",
            text: error instanceof Error ? error.message : "The agent stopped unexpectedly.",
          });
        }
      } finally {
        signal.removeEventListener("abort", release);
        if (!signal.aborted) release();
        if (round.current === controller) round.current = null;
      }
    }

    void play();
    return () => controller.abort();
  }, [append, blocked, client, closeLink, controls, game, report, screen, title, visible]);

  let status: AgentStatus = failure ? "error" : "offline";
  if (connecting) status = "connecting";
  if (client) {
    if (blocked || !visible) status = "suspended";
    else status = game ? activity : "waiting";
  }

  return { status, connected: client !== null, inputPulse, log, diagnostics: diagnostics.join("\n"), connect, disconnect, takeOver, stopRound };
}
