export const gameBoyButtons = ["up", "down", "left", "right", "a", "b", "start", "select"] as const;
export type GameBoyButton = (typeof gameBoyButtons)[number];

export const lcdWidth = 160;
export const lcdHeight = 144;
export const observationScale = 2;
export const frameDataPrefix = "data:image/png;base64,";
export const maxHoldFrames = 90;
export const maxWaitFrames = 120;
export const moveHistorySize = 10;
export const attemptHistorySize = 6;
export const inferenceTimeoutMs = 30_000;
export const slowDecisionMs = 5_000;
export const gameplayModel = "anthropic/claude-sonnet-5.5";
export const gameplayModelName = "Sonnet 5.5";

export type Move = {
  buttons: GameBoyButton[];
  frames: number;
};

export type Decision = {
  intent: string;
  move: Move;
};

const turnResults = ["changed", "unchanged", "revisited", "stale", "blocked"] as const;
export type TurnResult = (typeof turnResults)[number];
export type Turn = {
  move: Move;
  result: TurnResult;
  intent?: string;
  screens?: { from: number; to: number };
};
export type HistoryEntry = Turn | `WAITED ${number} TIMES`;

export type Observation = {
  image: string;
  title: string;
  screen?: number;
  history: HistoryEntry[];
  blocked: GameBoyButton[][];
};

export type DecisionReply =
  | { decision: Decision }
  | { retryAfterMs: number; reason?: "timeout" | "capacity" | "pending" }
  | { error: "invalid-observation" | "invalid-decision" | "inference-failed" };

export type ObserveMessage = {
  type: "observe";
  id: string;
  observation: Observation;
};

export type DecisionStartedMessage = { type: "decision-started"; id: string };

export type DecisionTiming = {
  workerMs: number;
  aiMs?: number;
  stage?: "observation" | "binding-deadline" | "workers-ai" | "model-output" | "previous-inference";
  code?: number;
  pendingRequestId?: string;
  pendingMs?: number;
  outputTokens?: number;
};

export type DecisionMessage = {
  type: "decision";
  id: string;
  reply: DecisionReply;
  timing?: DecisionTiming;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGameBoyButton(value: unknown): value is GameBoyButton {
  return gameBoyButtons.some((button) => button === value);
}

function isButtons(value: unknown): value is GameBoyButton[] {
  return (
    Array.isArray(value) &&
    value.length <= 3 &&
    value.every(isGameBoyButton) &&
    new Set(value).size === value.length &&
    !(value.includes("up") && value.includes("down")) &&
    !(value.includes("left") && value.includes("right"))
  );
}

function isMove(value: unknown): value is Move {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false;
  const { buttons, frames } = value;
  return (
    typeof frames === "number" &&
    Number.isInteger(frames) &&
    frames >= 1 &&
    isButtons(buttons) &&
    frames <= (buttons.length ? maxHoldFrames : maxWaitFrames)
  );
}

function isIntent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

export function isDecision(value: unknown): value is Decision {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isIntent(value.intent) &&
    isMove(value.move)
  );
}

function isScreenId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isTurn(value: unknown): value is Turn {
  if (!isRecord(value) || !isMove(value.move) || !turnResults.some((result) => result === value.result)) {
    return false;
  }
  const hasIntent = "intent" in value;
  const hasScreens = "screens" in value;
  const screens = value.screens;
  return Object.keys(value).length === 2 + Number(hasIntent) + Number(hasScreens) &&
    (!hasIntent || isIntent(value.intent)) &&
    (!hasScreens || (isRecord(screens) && Object.keys(screens).length === 2 &&
      isScreenId(screens.from) && isScreenId(screens.to)));
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return typeof value === "string" ? /^WAITED [1-9]\d{0,15} TIMES$/.test(value) : isTurn(value);
}

function isFrame(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 192_000 || !value.startsWith(frameDataPrefix)) {
    return false;
  }

  try {
    const png = atob(value.slice(frameDataPrefix.length));
    const size = (offset: number) =>
      png.charCodeAt(offset) * 0x1000000 + png.charCodeAt(offset + 1) * 0x10000 +
      png.charCodeAt(offset + 2) * 0x100 + png.charCodeAt(offset + 3);
    return png.length >= 57 &&
      png.startsWith("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR") &&
      png.endsWith("\x00\x00\x00\x00IEND\xaeB`\x82") &&
      size(16) === lcdWidth * observationScale &&
      size(20) === lcdHeight * observationScale;
  } catch {
    return false;
  }
}

export function isObservation(value: unknown): value is Observation {
  return (
    isRecord(value) &&
    Object.keys(value).length === ("screen" in value ? 5 : 4) &&
    typeof value.title === "string" &&
    /^[ -~]{1,16}$/.test(value.title) &&
    (!("screen" in value) || isScreenId(value.screen)) &&
    Array.isArray(value.history) &&
    value.history.length <= moveHistorySize * 2 + 1 &&
    value.history.every(isHistoryEntry) &&
    value.history.filter((entry) => typeof entry !== "string").length <= moveHistorySize &&
    Array.isArray(value.blocked) &&
    value.blocked.length <= attemptHistorySize &&
    value.blocked.every(isButtons) &&
    isFrame(value.image)
  );
}
