export const gameBoyButtons = ["up", "down", "left", "right", "a", "b", "start", "select"] as const;
export type GameBoyButton = (typeof gameBoyButtons)[number];

export const lcdWidth = 160;
export const lcdHeight = 144;
export const observationScale = 2;
export const maxHoldFrames = 90;
export const maxWaitFrames = 120;
export const historySize = 6;
export const inferenceTimeoutMs = 30_000;

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
export type Turn = { move: Move; result: TurnResult; intent?: string };

export type Observation = {
  image: string;
  title: string;
  history: Turn[];
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

export type DecisionMessage = {
  type: "decision";
  id: string;
  reply: DecisionReply;
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

function isTurn(value: unknown): value is Turn {
  if (!isRecord(value) || !isMove(value.move) || !turnResults.some((result) => result === value.result)) {
    return false;
  }
  return "intent" in value
    ? Object.keys(value).length === 3 && isIntent(value.intent)
    : Object.keys(value).length === 2;
}

function isFrame(value: unknown): value is string {
  const prefix = "data:image/png;base64,";
  if (typeof value !== "string" || value.length > 192_000 || !value.startsWith(prefix)) {
    return false;
  }

  try {
    const png = atob(value.slice(prefix.length));
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
    Object.keys(value).length === 4 &&
    typeof value.title === "string" &&
    /^[ -~]{1,16}$/.test(value.title) &&
    Array.isArray(value.history) &&
    value.history.length <= historySize &&
    value.history.every(isTurn) &&
    Array.isArray(value.blocked) &&
    value.blocked.length <= historySize &&
    value.blocked.every(isButtons) &&
    isFrame(value.image)
  );
}
