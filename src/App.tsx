import { MgbaPlay } from "@wasm-gaming/mgba-wasm";
import { useEffect, useRef, useState } from "react";

// The SDK does not export its runtime assets as package subpaths.
import mgbaScriptUrl from "../node_modules/@wasm-gaming/mgba-wasm/dist/mgba/mgba.js?url&no-inline";
import mgbaWasmUrl from "../node_modules/@wasm-gaming/mgba-wasm/dist/mgba/mgba.wasm?url&no-inline";

const romUrl =
  "";

const gameBoyWidth = 160;
const gameBoyHeight = 144;

const keymap = [
  { button: "Move", key: "↑ ↓ ← →", label: "Arrow keys" },
  { button: "A", key: "X" },
  { button: "B", key: "Z" },
  { button: "Start", key: "Enter" },
  { button: "Select", key: "Right Shift" },
];

export default function App() {
  const screen = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "playing" | "error">("loading");

  useEffect(() => {
    const canvas = screen.current;
    if (!canvas) return;

    const controller = new AbortController();
    const { signal } = controller;
    let game: MgbaPlay | undefined;
    let unsubscribeFrame: (() => void) | undefined;

    async function start(display: HTMLCanvasElement) {
      try {
        const context = display.getContext("2d");
        if (!context) throw new Error("Could not create the game display");

        const response = await fetch(romUrl, { signal });
        if (!response.ok) throw new Error(`ROM download failed (HTTP ${response.status})`);
        const rom = await response.arrayBuffer();
        if (signal.aborted) return;

        const framebuffer = document.createElement("canvas");
        game = new MgbaPlay({
          config: { jsUrl: mgbaScriptUrl, wasmUrl: mgbaWasmUrl },
          assets: { rom },
          storage: { namespace: "pokemon-red" },
          mount: framebuffer,
        });
        unsubscribeFrame = game.onFrames(() => {
          // The Game Boy image is centered inside a Super Game Boy frame.
          const x = (framebuffer.width - gameBoyWidth) / 2;
          const y = (framebuffer.height - gameBoyHeight) / 2;
          context.drawImage(
            framebuffer,
            x, y, gameBoyWidth, gameBoyHeight,
            0, 0, gameBoyWidth, gameBoyHeight,
          );
        });
        await game.restart();
        if (!signal.aborted) setStatus("playing");
      } catch (error) {
        if (signal.aborted) return;
        console.error("Could not start mGBA", error);
        setStatus("error");
      }
    }

    function releaseKeys() {
      // Reapplying the default bindings also clears any held keys.
      game?.setControls({});
    }

    const startup = start(canvas);
    window.addEventListener("blur", releaseKeys);
    return () => {
      controller.abort();
      unsubscribeFrame?.();
      window.removeEventListener("blur", releaseKeys);
      void startup.then(() => game?.destroy()).catch((error) => {
        console.error("Could not stop mGBA", error);
      });
    };
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 px-5 py-8 text-zinc-100">
      <div className="w-full max-w-[480px]">
        <h1 className="mb-3 text-lg font-medium">Pokémon Red</h1>

        <div className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-md bg-black ring-1 ring-white/15">
          <canvas
            ref={screen}
            width={gameBoyWidth}
            height={gameBoyHeight}
            aria-label="Pokémon Red game screen"
            aria-describedby="keymap"
            className="h-auto w-full [image-rendering:pixelated]"
          />
          {status === "loading" && (
            <p role="status" className="absolute text-sm text-zinc-400">
              Loading ROM…
            </p>
          )}
          {status === "error" && (
            <div className="absolute text-center text-sm">
              <p role="alert">Couldn’t start Pokémon Red.</p>
              <button
                type="button"
                className="mt-3 cursor-pointer rounded border border-zinc-600 px-3 py-1.5 hover:bg-zinc-800"
                onClick={() => window.location.reload()}
              >
                Retry
              </button>
            </div>
          )}
        </div>

        <dl
          id="keymap"
          aria-label="Keyboard controls"
          className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-300"
        >
          {keymap.map(({ button, key, label }) => (
            <div key={button} className="flex items-center gap-2">
              <dt>{button}</dt>
              <dd>
                <kbd
                  aria-label={label}
                  className="inline-block rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-zinc-100"
                >
                  {key}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </main>
  );
}
