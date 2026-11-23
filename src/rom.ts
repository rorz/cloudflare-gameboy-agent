const maximumRomBytes = 8 * 1024 * 1024;
const legacyRedDigest = "5ca7ba01642a3b27b0cc0b5349b52792795b62d3ed977e98a09390659af96b7b";

export type Cartridge = {
  bytes: ArrayBuffer;
  saveNamespace: string;
};

function checkSize(length: number) {
  if (length > maximumRomBytes) throw new Error("Choose a ROM that is 8 MB or smaller.");
}

async function prepareCartridge(bytes: ArrayBuffer): Promise<Cartridge> {
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 0x150));
  const checksum = header.subarray(0x134, 0x14d).reduce((result, byte) => (result - byte - 1) & 0xff, 0);
  if (header.length < 0x150 || checksum !== header[0x14d]) {
    throw new Error("This file is missing a valid Game Boy cartridge header.");
  }

  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const digest = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    bytes,
    // The original cartridge keeps its existing browser save slot.
    saveNamespace: digest === legacyRedDigest ? "pokemon-red" : `gb-${digest}`,
  };
}

export async function openRomFile(file: File): Promise<Cartridge> {
  checkSize(file.size);
  return prepareCartridge(await file.arrayBuffer());
}

function downloadUrl(input: string): URL {
  const url = URL.parse(input.trim());
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new Error("Enter an HTTP or HTTPS download URL.");
  }

  const [, owner, repo, kind, ...path] = url.pathname.split("/");
  if (url.hostname === "github.com" && owner && repo && kind === "blob" && path.length >= 2) {
    return new URL(`https://raw.githubusercontent.com/${owner}/${repo}/${path.join("/")}`);
  }
  return url;
}

async function readDownload(response: Response): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The download returned no ROM data.");

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    checkSize(Number(response.headers.get("content-length")));
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      checkSize(size);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export async function openRomUrl(input: string, signal: AbortSignal): Promise<Cartridge> {
  const url = downloadUrl(input);
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    throw new Error("Couldn’t download that URL. Use a direct link that allows browser downloads (CORS).");
  }
  if (!response.ok) throw new Error(`The download returned HTTP ${response.status}.`);
  return prepareCartridge(await readDownload(response));
}
