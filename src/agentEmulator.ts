import type { MgbaPlay } from "@wasm-gaming/mgba-wasm";
import { lcdHeight, lcdWidth, observationScale } from "../shared/gameplay";

export type GameFrame = Uint8ClampedArray;

export function frameReader(screen: HTMLCanvasElement) {
  const lcd = screen.getContext("2d");
  const scaled = document.createElement("canvas");
  scaled.width = lcdWidth * observationScale;
  scaled.height = lcdHeight * observationScale;
  const context = scaled.getContext("2d", { alpha: false });
  if (!lcd || !context) throw new Error("Couldn’t read the game display.");
  context.imageSmoothingEnabled = false;

  return {
    sample(): GameFrame {
      return lcd.getImageData(0, 0, lcdWidth, lcdHeight).data;
    },
    image() {
      context.drawImage(screen, 0, 0, scaled.width, scaled.height);
      return scaled.toDataURL("image/png");
    },
  };
}

function differsBy(first: GameFrame, second: GameFrame, limit: number) {
  let changed = 0;
  for (let i = 0; i < first.length; i += 4) {
    if (Math.abs(first[i] - second[i]) > 8 ||
        Math.abs(first[i + 1] - second[i + 1]) > 8 ||
        Math.abs(first[i + 2] - second[i + 2]) > 8) changed++;
    if (changed > limit) return true;
  }
  return false;
}

export function sameSituation(a: GameFrame, b: GameFrame) {
  return !differsBy(a, b, 16);
}

export function isBlankFrame(pixels: GameFrame) {
  const colors = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
  return colors.every((color) => color === colors[0]);
}

export function staleFrame(observed: GameFrame, current: GameFrame) {
  return differsBy(observed, current, lcdWidth * lcdHeight * 0.2);
}

export async function pollScreen(
  game: MgbaPlay,
  sample: () => GameFrame,
  before: GameFrame,
  limit: number,
  signal: AbortSignal,
) {
  let frame = before;
  let frames = 0;
  let stableFrames = 0;
  while (frames < limit) {
    const advanced = await waitForFrames(game, Math.min(3, limit - frames), signal);
    frames += advanced;
    const current = sample();
    if (isBlankFrame(current)) {
      stableFrames = 0;
      continue;
    }
    stableFrames = sameSituation(frame, current) ? stableFrames + advanced : 0;
    frame = current;
    if (stableFrames >= 12 && !sameSituation(before, frame)) break;
  }
  return { frame, frames };
}

export function waitForFrames(game: MgbaPlay, frames: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<number>((resolve, reject) => {
    let elapsed = 0;
    const unsubscribe = game.onFrames((count) => {
      elapsed += count;
      if (elapsed < frames) return;
      cleanup();
      resolve(elapsed);
    });
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The game stopped advancing."));
    }, 2_000 + frames * 30);

    function cleanup() {
      unsubscribe();
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }

    function abort() {
      cleanup();
      reject(signal.reason);
    }

    signal.addEventListener("abort", abort, { once: true });
  });
}
