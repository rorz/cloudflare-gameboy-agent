import type { MgbaPlay } from "@wasm-gaming/mgba-wasm";
import { AgentClient } from "agents/client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  historySize, inferenceTimeoutMs, isDecision, maxHoldFrames, maxWaitFrames, type DecisionMessage, type DecisionReply,
  type GameBoyButton, type Move, type Observation, type ObserveMessage, type Turn,
} from "../shared/gameplay";
import { frameReader, pollScreen, sameSituation, staleFrame, waitForFrames, type GameFrame } from "./agentEmulator";
import type { GameBoyControlsHandle } from "./GameBoyControls";

type LogEntry =
  | { kind: "link" | "error" | "feedback"; text: string }
  | { kind: "intent"; text: string; elapsedMs: number }
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
const stallLimit = 3;
const retryLimit = 3;
const pendingTimeoutMs = 10_000;
const inputSettleFrames = 90;

function sameButtons(a: GameBoyButton[], b: GameBoyButton[]) {
  return a.length === b.length && a.every((button) => b.includes(button));
}

function requestDecision(agent: AgentClient, observation: Observation, signal: AbortSignal) {
  signal.throwIfAborted();
  const packet: ObserveMessage = { type: "observe", id: crypto.randomUUID(), observation };
  return new Promise<DecisionReply>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({ retryAfterMs: 1_000, reason: "timeout" });
    }, inferenceTimeoutMs + 2_000);

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
      let response: Partial<DecisionMessage> | null;
      try {
        response = JSON.parse(event.data);
      } catch {
        return;
      }
      if (response?.type !== "decision" || response.id !== packet.id || !response.reply) return;
      cleanup();
      resolve(response.reply);
    }

    signal.addEventListener("abort", abort, { once: true });
    agent.addEventListener("message", receive);
    try {
      agent.send(JSON.stringify(packet));
    } catch (error) {
      cleanup();
      reject(error);
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
    const connectionFailed = () => {
      if (link.current?.client === socket) {
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
    link.current = { client: socket, timeout: window.setTimeout(connectionFailed, 8_000), connected: false };
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
      try {
        const reader = frameReader(display);
        const history: Turn[] = [];
        const attempts: { before: GameFrame; move: Move }[] = [];
        let stalled = 0;
        let invalidDecisions = 0;
        let retries = 0;
        let pendingSince: number | undefined;

        function remember(turn: Turn) {
          history.push(turn);
          if (history.length > historySize) history.shift();
          if (turn.result === "changed" || turn.result === "stale") stalled = 0;
          else if (turn.move.buttons.length && ++stalled >= stallLimit) {
            throw new Error("Agent stopped after three button decisions without progress.");
          }
        }

        setActivity("observing");
        await waitForFrames(emulator, 1, signal);

        while (!signal.aborted) {
          setActivity("observing");
          const observed = reader.sample();
          const observation: Observation = {
            image: reader.image(),
            title,
            history,
            blocked: attempts.filter(({ before }) => sameSituation(before, observed)).map(({ move }) => move.buttons),
          };
          const startedAt = performance.now();
          const reply = await requestDecision(agent, observation, signal);
          signal.throwIfAborted();

          if ("retryAfterMs" in reply) {
            if (reply.reason === "pending") {
              setActivity("retrying");
              pendingSince ??= performance.now();
              if (performance.now() - pendingSince >= pendingTimeoutMs) {
                throw new Error("The previous model request is still running. Agent stopped to avoid overlapping calls.");
              }
              await wait(reply.retryAfterMs, signal);
              continue;
            }
            pendingSince = undefined;
            if (reply.reason) {
              setActivity("retrying");
              const reason = reply.reason === "timeout" ? "Decision exceeded the time limit." : "Workers AI is busy.";
              if (++retries >= retryLimit) throw new Error(`${reason} Agent stopped after ${retryLimit} attempts.`);
              append({ kind: "feedback", text: `${reason} Retrying with a fresh frame.` });
            }
            await wait(reply.retryAfterMs * 2 ** Math.max(0, retries - 1), signal);
            continue;
          }
          pendingSince = undefined;
          retries = 0;
          if ("error" in reply || !isDecision(reply.decision)) {
            if ("error" in reply && reply.error === "inference-failed") {
              throw new Error("Workers AI couldn’t read the frame.");
            }
            if (++invalidDecisions < 2) continue;
            throw new Error("The agent couldn’t produce valid controls.");
          }
          invalidDecisions = 0;

          const { move, intent } = reply.decision;
          const elapsedMs = performance.now() - startedAt;
          const hasInput = move.buttons.length > 0;
          const before = hasInput ? reader.sample() : observed;
          if (hasInput && staleFrame(observed, before)) {
            append({ kind: "feedback", text: "Skipped an input because the game state changed." });
            remember({ intent, move, result: "stale" });
            continue;
          }
          if (hasInput && attempts.some(({ before: frame, move: tried }) =>
            sameButtons(tried.buttons, move.buttons) && sameSituation(frame, before)
          )) {
            append({ kind: "feedback", text: "Skipped an input that already led here." });
            remember({ intent, move, result: "blocked" });
            continue;
          }
          signal.throwIfAborted();
          append({ kind: "intent", text: intent, elapsedMs });
          let heldFrames = 0;
          if (hasInput) {
            setActivity("moving");
            buttons.setAgentButtons(move.buttons);
            setInputPulse((count) => count + 1);
            heldFrames = await waitForFrames(emulator, move.frames, signal);
            signal.throwIfAborted();
            release();
          }
          setActivity("watching");
          const { frame: after, frames: polledFrames } = await pollScreen(
            emulator, reader.sample, before, hasInput ? inputSettleFrames : move.frames, signal,
          );
          signal.throwIfAborted();
          const frames = hasInput ? heldFrames : polledFrames;
          const result = sameSituation(before, after) ? "unchanged"
            : attempts.some(({ before: frame }) => sameSituation(frame, after)) ? "revisited" : "changed";
          if (hasInput) {
            attempts.push({ before, move });
            if (attempts.length > historySize) attempts.shift();
          }
          append({ kind: "move", move: { buttons: move.buttons, frames }, result });
          remember({
            intent,
            move: { buttons: move.buttons, frames: Math.min(frames, hasInput ? maxHoldFrames : maxWaitFrames) },
            result,
          });
        }
      } catch (error) {
        if (!signal.aborted) {
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
  }, [append, blocked, client, closeLink, controls, game, screen, title, visible]);

  let status: AgentStatus = failure ? "error" : "offline";
  if (connecting) status = "connecting";
  if (client) {
    if (blocked || !visible) status = "suspended";
    else status = game ? activity : "waiting";
  }

  return { status, connected: client !== null, inputPulse, log, connect, disconnect, takeOver, stopRound };
}
