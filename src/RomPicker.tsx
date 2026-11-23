import { useRef, useState, type FormEvent, type RefObject } from "react";
import { openRomFile, openRomUrl, type Cartridge } from "./rom";

type RomPickerProps = {
  dialog: RefObject<HTMLDialogElement | null>;
  onChoose: (cartridge: Cartridge) => void;
  onClose: () => void;
};

export default function RomPicker({ dialog, onChoose, onClose }: RomPickerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const urlForm = useRef<HTMLFormElement>(null);
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState<"file" | "url" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(kind: "file" | "url", open: (signal: AbortSignal) => Promise<Cartridge>) {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(kind);
    setError(null);

    try {
      const cartridge = await open(controller.signal);
      if (controller.signal.aborted || !dialog.current?.open) return;
      onChoose(cartridge);
      dialog.current?.close();
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Couldn’t read this ROM.");
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(null);
      }
    }
  }

  function close() {
    request.current?.abort();
    request.current = null;
    setLoading(null);
    setError(null);
    urlForm.current?.reset();
    onClose();
  }

  function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get("url") ?? "");
    void load("url", (signal) => openRomUrl(url, signal));
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="choose-rom-title"
      onClose={close}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-auto rounded-2xl border border-stone-700 bg-[#211b17] p-5 text-stone-100 shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-sm sm:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="choose-rom-title" className="text-lg font-semibold tracking-tight">Choose ROM</h2>
        <button
          type="button"
          aria-label="Close ROM picker"
          className="grid size-8 cursor-pointer place-items-center rounded-md text-xl leading-none text-stone-400 hover:bg-white/8 hover:text-stone-100"
          onClick={() => dialog.current?.close()}
        >
          ×
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-stone-700/80 bg-black/12 p-3.5">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => fileInput.current?.click()}
          className="cursor-pointer rounded-md border border-stone-600 px-3 py-1.5 text-sm font-medium hover:bg-white/8 disabled:cursor-wait disabled:opacity-55"
        >
          Choose file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".gb,.gbc,.sgb"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void load("file", () => openRomFile(file));
          }}
        />
        <p className="mt-2 text-xs text-stone-400">Game Boy ROMs stay in your browser.</p>
      </div>

      <form ref={urlForm} onSubmit={submitUrl} className="mt-4">
        <label htmlFor="cartridge-url" className="text-sm font-medium">ROM URL</label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="cartridge-url"
            name="url"
            type="url"
            autoComplete="off"
            required
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-md border border-stone-600 bg-black/18 px-3 py-2 text-sm outline-none placeholder:text-stone-500 focus:border-orange-300/80"
          />
          <button
            type="submit"
            disabled={loading !== null}
            className="cursor-pointer rounded-md bg-[#f6821f] px-3.5 py-2 text-sm font-semibold text-[#251306] hover:bg-orange-300 disabled:cursor-wait disabled:opacity-55"
          >
            Load
          </button>
        </div>
      </form>

      {loading && <p role="status" className="mt-3 text-sm text-stone-300">{loading === "file" ? "Reading ROM…" : "Downloading ROM…"}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-orange-200">{error}</p>}
    </dialog>
  );
}
