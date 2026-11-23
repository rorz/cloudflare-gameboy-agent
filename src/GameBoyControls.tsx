import { exposeAsGamepad, type VirtualGamepad } from "@wasm-gaming/engine-specs";
import { DEFAULT_KEYMAP, DEFAULT_PADMAP } from "@wasm-gaming/mgba-wasm";
import { useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type Ref } from "react";
import { gameBoyButtons, type GameBoyButton as Control } from "../shared/gameplay";

const directions = ["up", "left", "right", "down"] as const;
const faceButtons = ["b", "a"] as const;
const systemButtons = ["select", "start"] as const;

const controlLabels: Record<Control, string> = {
  up: "Up",
  left: "Left",
  right: "Right",
  down: "Down",
  a: "A",
  b: "B",
  select: "Select",
  start: "Start",
};

const controlForKey = new Map(gameBoyButtons.map((control) => [DEFAULT_KEYMAP[`p1.${control}`], control]));
const minimumPressMs = 50;

const rockerCorner = [
  [63.6, 0], [66, 0.7], [67.7, 2.35], [68.4, 4.85], [68.4, 30.4],
  [69.6, 31.6], [95.15, 31.6], [97.65, 32.3], [99.3, 34], [100, 36.4],
] as const;

const rockerOutline = [
  ...rockerCorner,
  ...rockerCorner.map(([x, y]) => [100 - y, x]),
  ...rockerCorner.map(([x, y]) => [100 - x, 100 - y]),
  ...rockerCorner.map(([x, y]) => [y, 100 - x]),
];

const rockerShape = {
  "--cross": `polygon(${rockerOutline.map(([x, y]) => `${x}% ${y}%`).join(", ")})`,
} as CSSProperties;

const rockerWalls = rockerOutline.map(([x, y], index) => {
  const [nextX, nextY] = rockerOutline[(index + 1) % rockerOutline.length];
  const dx = nextX - x;
  const dy = nextY - y;
  const length = Math.hypot(dx, dy);
  const light = (0.83 * dx - 0.55 * dy) / length;

  return {
    key: `${x}-${y}`,
    style: {
      left: `${x}%`,
      top: `${y}%`,
      width: `${length}%`,
      "--edge-angle": `${Math.atan2(dy, dx)}rad`,
      "--edge-shade": `hsl(42 9% ${27 + light * 8}%)`,
    } as CSSProperties,
  };
});

type HeldControl = {
  pointers: Set<number>;
  startedAt: number;
  releaseTimer?: number;
};

export type GameBoyControlsHandle = {
  setAgentButtons(buttons: readonly Control[]): void;
};

type GameBoyControlsProps = {
  disabled: boolean;
  onManualInput: () => void;
  ref: Ref<GameBoyControlsHandle>;
};

export default function GameBoyControls({ disabled, onManualInput, ref }: GameBoyControlsProps) {
  const gamepad = useRef<VirtualGamepad | null>(null);
  const [keys, setKeys] = useState<Partial<Record<Control, boolean>>>({});
  const [pad, setPad] = useState<ReadonlySet<Control>>(() => new Set());
  const held = useRef(new Map<Control, HeldControl>());
  const agentButtons = useRef<readonly Control[]>([]);

  const syncPad = useCallback(() => {
    const virtualPad = gamepad.current;
    if (!virtualPad) return;
    const active = new Set([...held.current.keys(), ...agentButtons.current]);
    for (const control of gameBoyButtons) {
      const pressed = active.has(control);
      const button = virtualPad.buttons[DEFAULT_PADMAP[control]];
      button.pressed = pressed;
      button.touched = pressed;
      button.value = pressed ? 1 : 0;
    }
    virtualPad.timestamp = performance.now();
    setPad(active);
  }, []);

  useImperativeHandle(ref, () => ({
    setAgentButtons(buttons) {
      if (!buttons.length && !agentButtons.current.length) return;
      agentButtons.current = buttons;
      syncPad();
    },
  }), [syncPad]);

  const onManualKey = useEffectEvent(() => {
    if (!disabled) onManualInput();
  });

  useEffect(() => {
    const virtualPad: VirtualGamepad = {
      id: "Cloudboy controls",
      index: 0,
      connected: false,
      mapping: "standard",
      timestamp: 0,
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0],
      vibrationActuator: null,
    };
    gamepad.current = virtualPad;
    const active = held.current;
    const disconnect = exposeAsGamepad(virtualPad);

    function clearPointerInput() {
      for (const press of active.values()) window.clearTimeout(press.releaseTimer);
      active.clear();
    }

    function releaseAll() {
      clearPointerInput();
      syncPad();
      setKeys({});
    }

    function onKey(event: KeyboardEvent) {
      const control = controlForKey.get(event.code);
      if (!control || event.repeat) return;
      if (event.type === "keydown") onManualKey();
      setKeys((current) => ({ ...current, [control]: event.type === "keydown" }));
    }

    function onVisibilityChange() {
      if (document.hidden) releaseAll();
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", releaseAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", releaseAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearPointerInput();
      agentButtons.current = [];
      disconnect();
      gamepad.current = null;
    };
  }, [syncPad]);

  function press(control: Control, pointer?: number) {
    onManualInput();
    const entry: HeldControl = held.current.get(control) ?? { pointers: new Set<number>(), startedAt: 0 };
    window.clearTimeout(entry.releaseTimer);
    entry.startedAt = performance.now();
    if (pointer !== undefined) entry.pointers.add(pointer);
    held.current.set(control, entry);
    syncPad();
  }

  function release(control: Control, pointer?: number) {
    const entry = held.current.get(control);
    if (!entry || (pointer !== undefined && !entry.pointers.delete(pointer))) return;
    if (entry.pointers.size) return;

    function finish() {
      held.current.delete(control);
      syncPad();
    }

    const remaining = minimumPressMs - (performance.now() - entry.startedAt);
    if (remaining > 0) entry.releaseTimer = window.setTimeout(finish, remaining);
    else finish();
  }

  function buttonProps(control: Control) {
    const onRelease = (event: PointerEvent<HTMLButtonElement>) => release(control, event.pointerId);
    return {
      type: "button" as const,
      disabled,
      "aria-label": controlLabels[control],
      "data-pressed": keys[control] || pad.has(control) || undefined,
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        press(control, event.pointerId);
      },
      onPointerUp: onRelease,
      onPointerCancel: onRelease,
      onLostPointerCapture: onRelease,
      onClick(event: MouseEvent<HTMLButtonElement>) {
        if (event.detail !== 0) return;
        press(control);
        release(control);
      },
    };
  }

  return (
    <div role="group" aria-label="Cloudboy controls" className="game-controls absolute inset-0">
      <div className="dpad-well absolute grid place-items-center">
        <div className="dpad relative grid grid-cols-3 grid-rows-3" style={rockerShape}>
          <div aria-hidden="true" className="dpad-grille pointer-events-none absolute inset-0">
            <span className="dpad-rim absolute" />
            <span className="dpad-aperture absolute inset-0" />
            <span className="dpad-shadow absolute" />
          </div>
          <div aria-hidden="true" className="dpad-cap pointer-events-none absolute">
            {rockerWalls.map(({ key, style }) => (
              <span key={key} className="dpad-wall absolute" style={style} />
            ))}
            <div className="dpad-face absolute inset-0 grid grid-cols-3 grid-rows-3">
              <span className="dpad-cross absolute inset-0" />
              <span className="dpad-center absolute" />
              {directions.map((direction) => (
                <span key={direction} data-direction={direction} className="relative grid place-items-center">
                  <span className="direction-mark" />
                </span>
              ))}
            </div>
          </div>
          {directions.map((direction) => (
            <button
              key={direction}
              {...buttonProps(direction)}
              data-direction={direction}
              className="game-key direction-key relative"
            />
          ))}
        </div>
      </div>

      <div className="face-buttons absolute flex items-center">
        {faceButtons.map((control) => (
          <div key={control} className="face-well grid place-items-center">
            <button {...buttonProps(control)} className="game-key face-key relative grid place-items-center font-bold">
              <span>{controlLabels[control]}</span>
            </button>
          </div>
        ))}
      </div>

      <div className="system-buttons absolute flex items-start">
        {systemButtons.map((control) => (
          <button key={control} {...buttonProps(control)} className="game-key system-key flex flex-col items-center uppercase">
            <span aria-hidden="true" className="system-pill" />
            <span>{controlLabels[control]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
