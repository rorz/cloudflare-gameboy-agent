import { MgbaPlay } from "@wasm-gaming/mgba-wasm";
import { useEffect, useRef, useState } from "react";
import cloudflareMark from "./assets/cloudflare.svg";
import mainboard from "./assets/cloudboy-mainboard.svg";
import regulator from "./assets/cloudboy-regulator.svg";
import GameBoyControls from "./GameBoyControls";

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

const speakerHoles = [
  { radius: 18, count: 7, offset: 0.3 },
  { radius: 29, count: 12, offset: 0.08 },
  { radius: 39, count: 16, offset: 0.18 },
].flatMap(({ radius, count, offset }) =>
  Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + offset;
    return {
      key: `${radius}-${index}`,
      left: `${50 + Math.cos(angle) * radius}%`,
      top: `${50 + Math.sin(angle) * radius}%`,
    };
  }),
);

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
    <main className="game-page overflow-clip px-2 text-stone-100 sm:px-6">
      <div className="game-layout relative mx-auto grid h-dvh w-full max-w-[1320px] grid-rows-[auto_minmax(0,1fr)]">
        <header className="game-header z-20 grid items-center px-1">
          <div className="flex items-center gap-2.5 text-[13px] font-semibold tracking-[-0.02em] text-stone-200">
            <img src={cloudflareMark} alt="" className="h-auto w-7" />
            Cloudboy Color
          </div>
          <h1 className="game-title justify-self-end text-[13px] font-medium text-stone-300">Pokémon Red</h1>
          <dl
            id="keymap"
            aria-label="Keyboard controls"
            className="game-keymap flex flex-wrap justify-center gap-x-3 gap-y-1.5 text-[11px] font-medium text-stone-400"
          >
            {keymap.map(({ button, key, label }) => (
              <div key={button} className="flex items-center gap-1.5">
                <dt>{button}</dt>
                <dd>
                  <kbd
                    aria-label={label}
                    className="keycap inline-block min-w-5 rounded-sm px-1.5 py-0.5 text-center font-mono text-stone-200"
                  >
                    {key}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </header>

        <div className="game-stage relative isolate flex items-end justify-center rounded-2xl sm:rounded-3xl">
          <div className="game-device relative z-10 select-none">
            <div className="game-body relative isolate" role="group" aria-label="Cloudboy Color">
              <div aria-hidden="true" className="shell-interior pointer-events-none absolute overflow-hidden">
                <img src={mainboard} alt="" className="shell-mainboard absolute inset-0 h-full w-full object-fill" />
                <img src={regulator} alt="" className="shell-regulator absolute" />
                <span className="shell-rail shell-rail-left absolute" />
                <span className="shell-rail shell-rail-right absolute" />
                <span className="shell-clip absolute left-[12%]" />
                <span className="shell-clip absolute right-[12%]" />
                <span className="shell-screw absolute left-[4%] top-[57%]" />
                <span className="shell-screw absolute right-[13%] top-[54%]" />
                <span className="shell-screw absolute left-[6%] top-[77%]" />
                <span className="shell-screw absolute left-[40%] top-[69%]" />
                <span className="shell-screw absolute right-[6%] top-[74%]" />
                <span className="shell-screw absolute right-[32%] top-[81%]" />
              </div>
              <div aria-hidden="true" className="shell-switch pointer-events-none absolute" />

              <div className="game-lens absolute z-10">
                <div aria-hidden="true" className="game-power absolute flex flex-col items-center" data-powered={status === "playing"}>
                  <span className="power-indicator flex items-center">
                    <span className="power-light" />
                    <span className="power-waves flex items-center"><span /><span /><span /></span>
                  </span>
                  <span className="font-mono font-semibold">POWER</span>
                </div>
                <div className="game-lcd absolute grid aspect-square place-items-center overflow-hidden">
                  <canvas
                    ref={screen}
                    width={gameBoyWidth}
                    height={gameBoyHeight}
                    aria-label="Pokémon Red game screen"
                    aria-describedby="keymap"
                    className="block h-auto w-full [image-rendering:pixelated]"
                  />
                  {status === "loading" && <p role="status" className="game-message absolute">Loading ROM…</p>}
                  {status === "error" && (
                    <div className="game-message absolute px-2 text-center">
                      <p role="alert">Couldn’t start Pokémon Red.</p>
                      <button
                        type="button"
                        className="mt-2 cursor-pointer rounded border border-stone-600 px-2.5 py-1 hover:bg-stone-800"
                        onClick={() => window.location.reload()}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
                <div aria-hidden="true" className="game-model absolute flex items-baseline justify-center font-black italic leading-none">
                  <span>CLOUDBOY</span>
                  <span className="model-color"><span>C</span><span>O</span><span>L</span><span>O</span><span>R</span></span>
                </div>
              </div>

              <div aria-hidden="true" className="shell-stamp pointer-events-none absolute grid place-items-center" />
              <GameBoyControls disabled={status !== "playing"} />
              <div aria-hidden="true" className="shell-speaker pointer-events-none absolute">
                <div className="speaker-face absolute">
                  {speakerHoles.map(({ key, left, top }) => (
                    <span key={key} className="speaker-hole absolute" style={{ left, top }} />
                  ))}
                </div>
              </div>
              <div aria-hidden="true" className="shell-port pointer-events-none absolute" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
