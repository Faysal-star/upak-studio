# DPAK-UPLOAD v1 — serial asset upload protocol

Host: browser (Web Serial, `src/lib/serial.ts`). Device: DeskPet firmware (to be
implemented — this document is the contract). Transport: UART, **115200 baud**,
8N1, no flow control.

## Flow

```
host                                   device
----                                   ------
DPAK-UPLOAD v1 <size> <crc32hex>\n  ->
                                    <- OK\n            (or ERR <reason>\n)
[u16 LE chunkLen][chunkLen bytes][u32 LE crc32-of-chunk]
                                    <- A\n             (chunk accepted)
        ... repeat per chunk; on CRC mismatch:
                                    <- R\n             (host resends same chunk)
        ... after the last chunk is A'ck'ed:
                                    <- DONE\n          (total CRC verified,
                                                        /demo.dpak written)
```

## Handshake

- Host sends one ASCII line: `DPAK-UPLOAD v1 <size> <crc32hex>\n`
  - `<size>`: total pack size in bytes, decimal.
  - `<crc32hex>`: CRC-32 (IEEE, poly 0xEDB88320 — same as the DPAK header CRC)
    of the entire pack, 8 lowercase hex digits, zero-padded.
- Device replies `OK\n` to accept, or `ERR <reason>\n` to refuse
  (e.g. `ERR busy`, `ERR too-big`).

### Host rules (normative — learned on real hardware)

Opening the serial port usually **resets the ESP32** (DTR/RTS auto-reset /
USB-Serial-JTAG), which (a) drops any bytes sent while it reboots and
(b) emits boot-log lines. Therefore the host MUST:

1. After opening, set DTR/RTS low if the API allows, then drain and discard
   incoming data for a **fixed ≈1.5 s**. (Fixed, not "until quiet" — the
   firmware logs an FPS line every second, so the line never goes quiet.)
2. Treat any line that is not exactly `OK` / `A` / `R` / `DONE` and does not
   start with `ERR` as **noise — ignore it and keep waiting** (never abort on
   it). This applies in every wait state, not just the handshake.
3. Re-send the handshake line up to **3 times** (3 s wait each) before
   declaring "device not responding" — the first one is often eaten by the
   reboot.

## Chunks

- Binary framing, host → device: `[u16 LE chunkLen][chunkLen bytes][u32 LE crc]`.
  - `crc` = CRC-32 of the `chunkLen` payload bytes only.
  - Host uses `chunkLen` = 1024 (last chunk smaller). Devices MUST accept any
    `chunkLen` in 1..4096.
- Device verifies the chunk CRC:
  - match → append to buffer/flash staging, reply `A\n`.
  - mismatch → discard, reply `R\n`; host resends the **same** chunk.
- Host resend limit: 5 attempts per chunk, then abort.
- Host timeout per ack: **5 s**.
- Chunks are strictly sequential; there is no chunk index. After `R`, the
  device's expected offset is unchanged.

## Completion

- After the final chunk is acked, the device verifies the CRC-32 of the whole
  received image against the handshake value, writes it to LittleFS as
  `/demo.dpak` (atomically: write temp file, then rename), and replies `DONE\n`.
- Any failure at this stage: `ERR <reason>\n` instead of `DONE`.
- Host timeout for `DONE`: **10 s** (allows for flash write time).

## Device implementation notes (firmware milestone)

- Recognize the handshake line from the normal log/CLI stream; everything
  between `OK` and `DONE`/`ERR` is binary — suspend log output on this UART.
- Reject `<size>` larger than free LittleFS space in the handshake.
- v1 always writes `/demo.dpak`; a target-filename field is a v2 extension
  (append to the handshake line — parsers MUST ignore trailing fields).
