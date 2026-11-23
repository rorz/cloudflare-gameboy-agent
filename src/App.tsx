import { MgbaPlay } from "@wasm-gaming/mgba-wasm";
import { useEffect, useRef, useState } from "react";
import { lcdHeight as gameBoyHeight, lcdWidth as gameBoyWidth } from "../shared/gameplay";
import AgentCircuit from "./AgentCircuit";
import AgentPane from "./AgentPane";
import mainboard from "./assets/cloudboy-mainboard.svg";
import regulator from "./assets/cloudboy-regulator.svg";
import GameBoyControls, { type GameBoyControlsHandle } from "./GameBoyControls";
import RomPicker from "./RomPicker";
import type { Cartridge } from "./rom";
import { useGameplayAgent } from "./useGameplayAgent";

// The SDK does not export its runtime assets as package subpaths.
import mgbaScriptUrl from "../node_modules/@wasm-gaming/mgba-wasm/dist/mgba/mgba.js?url&no-inline";
import mgbaWasmUrl from "../node_modules/@wasm-gaming/mgba-wasm/dist/mgba/mgba.wasm?url&no-inline";

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
  const controls = useRef<GameBoyControlsHandle>(null);
  const picker = useRef<HTMLDialogElement>(null);
  const activeGame = useRef<MgbaPlay | null>(null);
  const stopped = useRef(Promise.resolve());
  const [runningGame, setRunningGame] = useState<MgbaPlay | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(() => window.matchMedia("(min-width: 700px)").matches);
  const [cartridge, setCartridge] = useState<Cartridge | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "playing" | "error"
  >("idle");
  const agent = useGameplayAgent({
    game: status === "playing" ? runningGame : null,
    title: cartridge?.title ?? "Game Boy",
    screen,
    controls,
    blocked: pickerOpen,
  });

  useEffect(() => {
    const canvas = screen.current;
    if (!canvas || !cartridge) return;

    const controller = new AbortController();
    const { signal } = controller;
    let game: MgbaPlay | undefined;
    let unsubscribeFrame: (() => void) | undefined;

    async function start(display: HTMLCanvasElement, selected: Cartridge) {
      if (signal.aborted) return;
      try {
        const context = display.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Could not create the game display");
        context.clearRect(0, 0, gameBoyWidth, gameBoyHeight);

        const framebuffer = document.createElement("canvas");
        game = new MgbaPlay({
          config: { jsUrl: mgbaScriptUrl, wasmUrl: mgbaWasmUrl },
          options: { system: "gb" },
          assets: { rom: selected.bytes },
          storage: { namespace: selected.saveNamespace },
          mount: framebuffer,
        });
        unsubscribeFrame = game.onFrames(() => {
          // The Game Boy image is centered inside a Super Game Boy frame.
          const x = (framebuffer.width - gameBoyWidth) / 2;
          const y = (framebuffer.height - gameBoyHeight) / 2;
          context.drawImage(
            framebuffer,
            x,
            y,
            gameBoyWidth,
            gameBoyHeight,
            0,
            0,
            gameBoyWidth,
            gameBoyHeight,
          );
        });
        await game.restart();
        if (signal.aborted) return;
        activeGame.current = game;
        if (picker.current?.open) game.pause("rom-picker");
        setRunningGame(game);
        setStatus("playing");
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

    // Finish the previous cartridge's save flush before opening the next one.
    const startup = stopped.current.then(() => start(canvas, cartridge));
    window.addEventListener("blur", releaseKeys);
    return () => {
      controller.abort();
      unsubscribeFrame?.();
      window.removeEventListener("blur", releaseKeys);
      if (activeGame.current === game) activeGame.current = null;
      stopped.current = startup
        .then(async () => {
          await game?.destroy();
        })
        .catch((error) => {
          console.error("Could not stop mGBA", error);
        });
    };
  }, [cartridge]);

  function openPicker() {
    agent.stopRound();
    picker.current?.showModal();
    activeGame.current?.pause("rom-picker");
    setPickerOpen(true);
  }

  function chooseCartridge(selected: Cartridge) {
    setRunningGame(null);
    setStatus("loading");
    setCartridge(selected);
  }

  return (
    <main className="game-page overflow-clip px-2 text-stone-100 sm:px-6">
      <div
        className="game-layout relative mx-auto grid h-dvh w-full max-w-[1320px]"
        data-agent-open={agentOpen}
      >
        <header className="game-header z-20 grid items-center px-1">
          <div className="game-header-actions flex items-center justify-end gap-2" onKeyDown={(event) => {
            if (event.key === "Enter") event.stopPropagation();
          }}>
            {(status === "playing" || status === "loading") && (
              <button type="button" className="header-button keycap" onClick={openPicker}>Choose ROM</button>
            )}
            <button
              type="button"
              aria-controls="agent-pane"
              aria-expanded={agentOpen}
              onClick={() => setAgentOpen((open) => !open)}
              className="header-button agent-toggle keycap flex items-center gap-2"
            >
              {agent.connected && <span aria-hidden="true" className="agent-status-light" data-status={agent.status} />}
              Cloudflare Agent
              <span aria-hidden="true" className="agent-panel-glyph" />
            </button>
          </div>
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

        <div className="game-stage relative isolate flex min-w-0 items-end justify-center rounded-2xl sm:rounded-3xl">
          {agentOpen && <AgentCircuit connected={agent.connected} inputPulse={agent.inputPulse} />}
          <div className="game-device relative z-10 select-none">
            <div
              className="game-body relative isolate"
              role="group"
              aria-label="Cloudboy Color"
            >
              <div
                aria-hidden="true"
                className="shell-interior pointer-events-none absolute overflow-hidden"
              >
                <img
                  src={mainboard}
                  alt=""
                  className="shell-mainboard absolute inset-0 h-full w-full object-fill"
                />
                <img
                  src={regulator}
                  alt=""
                  className="shell-regulator absolute"
                />
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
              <div
                aria-hidden="true"
                className="shell-switch pointer-events-none absolute"
              />

              <div className="game-lens absolute z-10">
                <div
                  aria-hidden="true"
                  className="game-power absolute flex flex-col items-center"
                  data-powered={status === "playing"}
                >
                  <span className="power-indicator flex items-center">
                    <span className="power-light" />
                    <span className="power-waves flex items-center">
                      <span />
                      <span />
                      <span />
                    </span>
                  </span>
                  <span className="font-mono font-semibold">POWER</span>
                </div>
                <div className="game-lcd absolute grid aspect-square place-items-center overflow-hidden">
                  <canvas
                    ref={screen}
                    width={gameBoyWidth}
                    height={gameBoyHeight}
                    aria-label="Game Boy screen"
                    aria-describedby="keymap"
                    className="block h-auto w-full [image-rendering:pixelated]"
                  />
                  {status === "loading" && (
                    <p role="status" className="game-message absolute">
                      Starting ROM…
                    </p>
                  )}
                  {(status === "idle" || status === "error") && (
                    <div className="game-message absolute inset-0 grid content-center justify-items-center gap-[clamp(0.35rem,2.2cqw,0.9rem)] px-3 text-center">
                      {status === "idle" ? (
                        <h1 className="font-medium">Load a ROM to start...</h1>
                      ) : (
                        <p role="alert">Couldn’t start this ROM.</p>
                      )}
                      <button
                        type="button"
                        onClick={openPicker}
                        className="min-h-[clamp(2.125rem,13cqw,3.125rem)] w-full max-w-48 cursor-pointer rounded-lg bg-[#f6821f] px-2 text-[clamp(0.7rem,3cqw,0.975rem)] font-semibold text-[#251306] shadow-[inset_0_1px_0_#ffd09a,0_5px_14px_#0008] hover:bg-[#ffac58] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-200"
                      >
                        Choose ROM
                      </button>
                    </div>
                  )}
                </div>
                <div
                  aria-hidden="true"
                  className="game-model absolute flex items-baseline justify-center font-black italic leading-none"
                >
                  <span>CLOUDBOY</span>
                  <span className="model-color">
                    <span>C</span>
                    <span>O</span>
                    <span>L</span>
                    <span>O</span>
                    <span>R</span>
                  </span>
                </div>
              </div>

              <div
                aria-hidden="true"
                className="shell-stamp pointer-events-none absolute grid place-items-center"
              />
              <GameBoyControls disabled={status !== "playing"} onManualInput={agent.takeOver} ref={controls} />
              <div
                aria-hidden="true"
                className="shell-speaker pointer-events-none absolute"
              >
                <div className="speaker-face absolute">
                  {speakerHoles.map(({ key, left, top }) => (
                    <span
                      key={key}
                      className="speaker-hole absolute"
                      style={{ left, top }}
                    />
                  ))}
                </div>
              </div>
              <div
                aria-hidden="true"
                className="shell-port pointer-events-none absolute"
              />
            </div>
          </div>
        </div>
        <AgentPane
          open={agentOpen}
          canConnect={status === "playing" && !pickerOpen}
          status={agent.status}
          log={agent.log}
          diagnostics={agent.diagnostics}
          onConnect={agent.connect}
          onDisconnect={agent.disconnect}
        />
      </div>
      <RomPicker
        dialog={picker}
        onChoose={chooseCartridge}
        onClose={() => {
          activeGame.current?.resume("rom-picker");
          setPickerOpen(false);
        }}
      />
    </main>
  );
}
