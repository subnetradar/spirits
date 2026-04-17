/**
 * Build the provenance mapping for Subnet Spirits.
 *
 * Takes the rendered masters directory, shuffles the full list of
 * (netuid, variant) pairs deterministically, assigns tokenIds 1..N,
 * and writes:
 *   - provenance/mapping.json     — the full ordered mapping
 *   - provenance/hash.txt         — sha256 of mapping.json (commit on-chain)
 *   - provenance/seed.txt         — the random seed used (keep secret until reveal)
 *
 * Fairness: the seed is generated from crypto.randomBytes, hashed together
 * with the mapping into provenanceHash, and only published at reveal time.
 * Anyone can then re-run this script with the revealed seed and verify
 * the same mapping + hash is produced.
 *
 * Usage:
 *   node scripts/build-provenance.js               # fresh run, new seed
 *   node scripts/build-provenance.js --seed 0xABC  # reproduce from known seed
 *   node scripts/build-provenance.js --dry         # print, don't write
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { keccak_256 } = require("@noble/hashes/sha3.js");

const ROOT = path.join(__dirname, "..");
const MASTERS = path.join(ROOT, "masters");
const OUT_DIR = path.join(ROOT, "provenance");
const MAPPING_FILE = path.join(ROOT, "theme-mapping-complete.json");

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry");
const SEED_ARG = argVal("--seed");

// ─── Gather all (folder, variant) pairs from the theme mapping ─────────
const THEME = JSON.parse(fs.readFileSync(MAPPING_FILE, "utf-8"));
const entries = [];

for (const [folderKey, variants] of Object.entries(THEME)) {
  const snMatch = folderKey.match(/^SN(\d+)_/);
  const isBonus = folderKey.startsWith("BONUS_");

  let netuid, label, fileStem;
  if (snMatch) {
    netuid = parseInt(snMatch[1], 10);
    label = "SN";
    fileStem = `SN${netuid}`;
  } else if (isBonus) {
    netuid = 0;
    label = "BONUS";
    fileStem = folderKey; // keep full folder name for file resolution
  } else {
    console.warn(`Skip unknown folder: ${folderKey}`);
    continue;
  }

  for (const [variantPad, variantTheme] of Object.entries(variants)) {
    const variantNum = parseInt(variantPad, 10);
    const masterFile = `${fileStem}-${variantPad}.png`;
    const masterPath = path.join(MASTERS, masterFile);
    const isBonusVariant = isBonus || variantNum > 10;
    entries.push({
      folderKey,
      netuid,
      label,
      variantNum,
      variantPad,
      variantTheme,
      masterFile,
      rarity: isBonusVariant ? "MYTHIC" : null, // non-mythic rarity assigned post-shuffle
      hasMaster: fs.existsSync(masterPath),
    });
  }
}

console.log(`Loaded ${entries.length} (folder, variant) entries`);
const missing = entries.filter(e => !e.hasMaster).length;
if (missing) console.warn(`⚠️  ${missing} master files not yet rendered`);

// ─── Deterministic shuffle (seeded) ───────────────────────────────
// Solidity-compatible keccak256. Input = Buffer or hex-string; output = hex string (no 0x prefix).
function keccakHex(input) {
  const buf = typeof input === "string"
    ? Buffer.from(input.replace(/^0x/, ""), input.startsWith("0x") ? "hex" : "utf8")
    : Buffer.from(input);
  return Buffer.from(keccak_256(buf)).toString("hex");
}

// Mirror of Solidity's: keccak256(abi.encodePacked(bytes32 a, bytes32 b))
function keccakPacked32x32(hexA, hexB) {
  const a = Buffer.from(hexA.replace(/^0x/, ""), "hex");
  const b = Buffer.from(hexB.replace(/^0x/, ""), "hex");
  if (a.length !== 32 || b.length !== 32) throw new Error("Expected two 32-byte hex inputs");
  return Buffer.from(keccak_256(Buffer.concat([a, b]))).toString("hex");
}

function prngFromSeed(seedHex) {
  // Build a stream of bytes by hashing (seed || counter) repeatedly.
  let counter = 0;
  let buf = Buffer.alloc(0);
  let pos = 0;
  return () => {
    if (pos + 4 > buf.length) {
      const h = crypto.createHash("sha256");
      h.update(Buffer.from(seedHex.replace(/^0x/, ""), "hex"));
      h.update(Buffer.from([counter++, counter >>> 8, counter >>> 16, counter >>> 24]));
      buf = h.digest();
      pos = 0;
    }
    const n = buf.readUInt32BE(pos);
    pos += 4;
    return n / 0xFFFFFFFF;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const seed = SEED_ARG || "0x" + crypto.randomBytes(32).toString("hex");
console.log(`Seed: ${seed}${SEED_ARG ? " (from arg)" : " (fresh random)"}`);

const shuffled = shuffle(entries, prngFromSeed(seed));

// Assign rarity to non-mythic entries proportionally: 100 LEG / 310 RARE / rest COMMON
// among the non-MYTHIC slice. Mythic is already tagged per-entry.
const nonMythic = shuffled.filter(e => !e.rarity);
const LEG_COUNT = 100;
const RARE_COUNT = 310;
nonMythic.forEach((e, i) => {
  if (i < LEG_COUNT) e.rarity = "LEGENDARY";
  else if (i < LEG_COUNT + RARE_COUNT) e.rarity = "RARE";
  else e.rarity = "COMMON";
});

// ─── Build tokenId → entry mapping ────────────────────────────────
const mapping = shuffled.map((e, i) => ({
  tokenId: i + 1,
  netuid: e.netuid,
  folderKey: e.folderKey,
  variantNum: e.variantNum,
  variantTheme: e.variantTheme,
  masterFile: e.masterFile,
  rarity: e.rarity,
  label: e.label,
}));

// ─── Compute provenanceHash (Solidity-compatible) ────────────────
const mappingStr = JSON.stringify(mapping, null, 2);
// mappingHash = keccak256(utf8 bytes of mapping JSON)
const mappingHash = keccakHex(mappingStr);

// provenanceHash = keccak256(abi.encodePacked(seed, mappingHash))
// matches Solidity: keccak256(abi.encodePacked(_seed, _mappingHash))
const provenanceHash = keccakPacked32x32(seed, "0x" + mappingHash);

console.log(`\nTotal tokens:     ${mapping.length}`);
console.log(`MYTHIC:           ${mapping.filter(m => m.rarity === "MYTHIC").length}`);
console.log(`LEGENDARY:        ${mapping.filter(m => m.rarity === "LEGENDARY").length}`);
console.log(`RARE:             ${mapping.filter(m => m.rarity === "RARE").length}`);
console.log(`COMMON:           ${mapping.filter(m => m.rarity === "COMMON").length}`);
console.log(`\nMapping hash:     ${mappingHash}`);
console.log(`Provenance hash:  0x${provenanceHash}   ← commit this on deploy`);

if (DRY) {
  console.log("\n(dry run — nothing written)");
  process.exit(0);
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "mapping.json"), mappingStr);
fs.writeFileSync(path.join(OUT_DIR, "hash.txt"), `0x${provenanceHash}\n`);
fs.writeFileSync(path.join(OUT_DIR, "seed.txt"), `${seed}\n`);
fs.writeFileSync(path.join(OUT_DIR, "mapping-hash.txt"), `${mappingHash}\n`);

console.log(`\n✅ Written to ${OUT_DIR}/`);
console.log(`   mapping.json       (full ordered mapping)`);
console.log(`   hash.txt           (commit this in contract constructor)`);
console.log(`   seed.txt           ⚠️  KEEP SECRET until reveal`);
console.log(`   mapping-hash.txt   (intermediate; helps verify after reveal)`);
