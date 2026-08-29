// Generates firmware/data/face.dpak — the 6 built-in face expressions as DPAK
// EXPR assets. The numbers MIRROR the built-in tracks in
// firmware/lib/face/face_engine.c (this proves the data-driven path per
// ADR-003: assets found in /face.dpak override the compiled-in tables).
// Deterministic output: fixed packId, no timestamps.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPack, exprBlob, TYPE } from "./dpakw.mjs";
import { parsePack } from "./dpakr.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK_ID = 0xface0001face0001n;

// paramIds (docs/architecture/asset-format-dpak.md registry)
const P = {
  eyeLX: 0, eyeLY: 1, eyeRX: 2, eyeRY: 3, eyeW: 4, eyeH: 5, eyeRadius: 6,
  lidTopL: 7, lidTopR: 8, lidBotL: 9, lidBotR: 10, browL: 11, browR: 12,
  mouthOpen: 13, mouthCurve: 14, squash: 15,
};
const K = (tMs, value, easing = 0) => ({ tMs, value, easing });

// Keep in sync with k_happy/k_sleepy/k_angry/k_surprised/k_sad in face_engine.c.
const expressions = {
  expr_neutral: [], // zero tracks: the engine's neutral base pose
  expr_happy: [
    { paramId: P.lidBotL, keys: [K(0, 0, 2), K(300, 96)] },
    { paramId: P.lidBotR, keys: [K(0, 0, 2), K(300, 96)] },
    { paramId: P.mouthCurve, keys: [K(0, 40, 2), K(300, 200)] },
    { paramId: P.mouthOpen, keys: [K(0, 28, 2), K(300, 80)] },
    { paramId: P.eyeH, keys: [K(0, 16384, 2), K(300, 15360)] },
    { paramId: P.squash, keys: [K(0, 0, 4), K(220, 56, 2), K(440, 0)] },
  ],
  expr_sleepy: [
    { paramId: P.lidTopL, keys: [K(0, 120, 2), K(1500, 176, 3), K(3000, 150)] },
    { paramId: P.lidTopR, keys: [K(0, 120, 2), K(1500, 176, 3), K(3000, 150)] },
    { paramId: P.eyeH, keys: [K(0, 15104)] },
    { paramId: P.mouthCurve, keys: [K(0, 10)] },
    { paramId: P.mouthOpen, keys: [K(0, 12)] },
    { paramId: P.squash, keys: [K(0, 40)] },
  ],
  expr_angry: [
    { paramId: P.browL, keys: [K(0, 0, 2), K(250, 2560)] },
    { paramId: P.browR, keys: [K(0, 0, 2), K(250, 2560)] },
    { paramId: P.lidTopL, keys: [K(0, 70, 2), K(250, 110)] },
    { paramId: P.lidTopR, keys: [K(0, 70, 2), K(250, 110)] },
    { paramId: P.mouthCurve, keys: [K(0, -40, 2), K(250, -150)] },
    { paramId: P.mouthOpen, keys: [K(0, 20)] },
    { paramId: P.eyeH, keys: [K(0, 14080)] },
  ],
  expr_surprised: [
    { paramId: P.eyeW, keys: [K(0, 14336, 4), K(200, 16128)] },
    { paramId: P.eyeH, keys: [K(0, 16384, 4), K(200, 19456)] },
    { paramId: P.eyeRadius, keys: [K(0, 6656)] },
    { paramId: P.browL, keys: [K(0, -2048)] },
    { paramId: P.browR, keys: [K(0, -2048)] },
    { paramId: P.mouthOpen, keys: [K(0, 28, 2), K(200, 170)] },
    { paramId: P.mouthCurve, keys: [K(0, 0)] },
  ],
  expr_sad: [
    { paramId: P.lidTopL, keys: [K(0, 60, 2), K(400, 120)] },
    { paramId: P.lidTopR, keys: [K(0, 60, 2), K(400, 120)] },
    { paramId: P.browL, keys: [K(0, -2304)] },
    { paramId: P.browR, keys: [K(0, -2304)] },
    { paramId: P.mouthCurve, keys: [K(0, 40, 2), K(400, -180)] },
    { paramId: P.mouthOpen, keys: [K(0, 12)] },
    { paramId: P.eyeLY, keys: [K(0, -2560, 2), K(400, -1024)] },
    { paramId: P.eyeRY, keys: [K(0, -2560, 2), K(400, -1024)] },
    { paramId: P.squash, keys: [K(0, 24)] },
  ],
};

const assets = Object.entries(expressions).map(([name, tracks], i) => ({
  id: i + 1,
  type: TYPE.EXPR,
  name,
  blob: exprBlob({ tracks }),
}));

const pack = buildPack({ packId: PACK_ID, assets });
const parsed = parsePack(pack); // self-check: CRC + bounds

const outPath = path.join(HERE, "..", "..", "firmware", "data", "face.dpak");
fs.writeFileSync(outPath, pack);
console.log(`face.dpak: ${pack.length} bytes, ${parsed.tocCount} EXPR assets, packId=0x${PACK_ID.toString(16)}`);
for (const a of assets) console.log(`  ${a.name}: ${a.blob.length} B`);
console.log(`wrote ${outPath}`);
