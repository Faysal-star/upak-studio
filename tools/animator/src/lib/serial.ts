// Host side of the DPAK-UPLOAD v1 serial protocol (see tools/animator/PROTOCOL.md).
// Runs in the browser over Web Serial. Firmware side is a later milestone.

import { crc32, crc32hex } from "./crc32";

export const CHUNK_SIZE = 1024;
const HANDSHAKE_TIMEOUT_MS = 3000;
const ACK_TIMEOUT_MS = 5000;
const DONE_TIMEOUT_MS = 10000;
const MAX_CHUNK_RETRIES = 5;

// Minimal structural Web Serial types (avoids a hard dep on w3c-web-serial).
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

// Opening the port typically RESETS the ESP32 (DTR/RTS auto-reset circuit /
// USB-Serial-JTAG). The device then prints its boot log. So the host must:
// settle, discard non-protocol lines, and re-send the handshake a few times
// (a handshake sent mid-reboot is simply lost). See PROTOCOL.md "Host rules".
const BOOT_SETTLE_MS = 1500;
const HANDSHAKE_ATTEMPTS = 3;

export function webSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export async function requestSerialPort(): Promise<SerialPortLike> {
  const nav = navigator as unknown as {
    serial: { requestPort(): Promise<SerialPortLike> };
  };
  return nav.serial.requestPort();
}

class LineReader {
  private buf: number[] = [];
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async readLine(timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const nl = this.buf.indexOf(10);
      if (nl >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        return String.fromCharCode(...line).replace(/\r$/, "");
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("timeout");
      const result = await Promise.race([
        this.reader.read(),
        new Promise<"timeout">((res) => setTimeout(() => res("timeout"), remaining)),
      ]);
      if (result === "timeout") throw new Error("timeout");
      if (result.done) throw new Error("port closed");
      if (result.value) this.buf.push(...result.value);
    }
  }

  // Read and discard boot/log noise for a FIXED duration. Must be bounded:
  // the firmware logs an FPS line every second, so "wait until quiet" never ends.
  async drainFor(ms: number, onNoise?: (line: string) => void): Promise<void> {
    const deadline = Date.now() + ms;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      try {
        const line = await this.readLine(remaining);
        if (line.length && onNoise) onNoise(line);
      } catch {
        return;
      }
    }
  }
}

export interface UploadHooks {
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  onLog?: (line: string) => void;
}

export async function uploadDpak(
  port: SerialPortLike,
  pack: Uint8Array,
  hooks: UploadHooks = {}
): Promise<void> {
  const log = hooks.onLog ?? (() => {});
  await port.open({ baudRate: 115200 });
  const writable = port.writable;
  const readable = port.readable;
  if (!writable || !readable) {
    await port.close();
    throw new Error("Serial port has no readable/writable stream");
  }
  const writer = writable.getWriter();
  const rawReader = readable.getReader();
  const lines = new LineReader(rawReader);

  try {
    // Opening the port usually reboots the device — let boot finish and
    // discard its log output before talking protocol.
    try {
      await port.setSignals?.({ dataTerminalReady: false, requestToSend: false });
    } catch { /* not all ports support signals */ }
    log("waiting for device to settle...");
    await lines.drainFor(BOOT_SETTLE_MS, (l) => log(`~ ${l}`));

    const header = `DPAK-UPLOAD v1 ${pack.length} ${crc32hex(pack)}\n`;
    const enc = new TextEncoder();
    let ok = false;
    for (let attempt = 0; attempt < HANDSHAKE_ATTEMPTS && !ok; attempt++) {
      log(`> ${header.trim()}${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}`);
      await writer.write(enc.encode(header));
      const deadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break; // re-send handshake
        let reply: string;
        try {
          reply = await lines.readLine(remaining);
        } catch {
          break; // timeout — re-send handshake
        }
        if (reply === "OK") {
          log("< OK");
          ok = true;
          break;
        }
        if (reply.startsWith("ERR")) throw new Error(`Device rejected upload: "${reply}"`);
        if (reply.length) log(`~ ${reply}`); // boot/log noise — ignore
      }
    }
    if (!ok) {
      throw new Error("Device not responding (no OK after 3 handshakes). Is DeskPet firmware running on this port?");
    }

    let sent = 0;
    while (sent < pack.length) {
      const chunk = pack.subarray(sent, sent + CHUNK_SIZE);
      const frame = new Uint8Array(2 + chunk.length + 4);
      const dv = new DataView(frame.buffer);
      dv.setUint16(0, chunk.length, true);
      frame.set(chunk, 2);
      dv.setUint32(2 + chunk.length, crc32(chunk), true);

      let acked = false;
      for (let attempt = 0; attempt < MAX_CHUNK_RETRIES && !acked; attempt++) {
        await writer.write(frame);
        const deadline = Date.now() + ACK_TIMEOUT_MS;
        let resend = false;
        while (!acked && !resend) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error(`Device stopped responding at ${sent}/${pack.length} bytes`);
          let ack: string;
          try {
            ack = await lines.readLine(remaining);
          } catch {
            throw new Error(`Device stopped responding at ${sent}/${pack.length} bytes`);
          }
          if (ack === "A") acked = true;
          else if (ack === "R") {
            resend = true;
            log(`chunk @${sent} rejected, resending (attempt ${attempt + 2})`);
          } else if (ack.startsWith("ERR")) throw new Error(`Upload failed on device: "${ack}"`);
          else if (ack.length) log(`~ ${ack}`); // stray log line — ignore
        }
      }
      if (!acked) throw new Error(`Chunk @${sent} failed after ${MAX_CHUNK_RETRIES} attempts`);
      sent += chunk.length;
      hooks.onProgress?.(sent, pack.length);
    }

    const doneDeadline = Date.now() + DONE_TIMEOUT_MS;
    for (;;) {
      const remaining = doneDeadline - Date.now();
      if (remaining <= 0) throw new Error("Device did not confirm completion (DONE timeout)");
      let done: string;
      try {
        done = await lines.readLine(remaining);
      } catch {
        throw new Error("Device did not confirm completion (DONE timeout)");
      }
      if (done === "DONE") {
        log("< DONE");
        break;
      }
      if (done.startsWith("ERR")) throw new Error(`Upload failed on device: "${done}"`);
      if (done.length) log(`~ ${done}`);
    }
    log("Upload complete — device wrote /demo.dpak");
  } finally {
    try {
      await rawReader.cancel();
    } catch { /* ignore */ }
    try {
      rawReader.releaseLock();
      writer.releaseLock();
    } catch { /* ignore */ }
    try {
      await port.close();
    } catch { /* ignore */ }
  }
}
