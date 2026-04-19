/**
 * Build a Merkle root + per-address proofs for the whitelist.
 *
 * Input:  whitelist.txt  — one 0x... address per line
 * Output: merkle.json    — { root, proofs: { [address]: proof[] } }
 *
 * Leaf format (matches SubnetSpirits contract):
 *   keccak256(abi.encodePacked(address))
 *
 * Tree style: sorted pair keccak (standard OpenZeppelin pattern).
 */

const fs = require("fs");
const path = require("path");
const { keccak_256 } = require("@noble/hashes/sha3.js");

const ROOT = path.join(__dirname, "..");
const INPUT = path.join(ROOT, "whitelist.txt");
const OUTPUT = path.join(ROOT, "whitelist-merkle.json");

function keccak(buf) { return Buffer.from(keccak_256(buf)); }

function leafForAddress(addr) {
  const a = addr.toLowerCase().replace(/^0x/, "").padStart(40, "0");
  return keccak(Buffer.from(a, "hex")); // keccak256(20 bytes address)
}

function sortedPair(a, b) {
  return Buffer.compare(a, b) < 0
    ? keccak(Buffer.concat([a, b]))
    : keccak(Buffer.concat([b, a]));
}

function buildTree(leaves) {
  // Standard sorted-pair Merkle: pad odd layer by repeating last element.
  if (leaves.length === 0) throw new Error("Empty whitelist");
  let layer = leaves.slice();
  const layers = [layer];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = i + 1 < layer.length ? layer[i + 1] : a;
      next.push(sortedPair(a, b));
    }
    layers.push(next);
    layer = next;
  }
  return layers;
}

function proofFor(layers, index) {
  const proof = [];
  for (let i = 0; i < layers.length - 1; i++) {
    const layer = layers[i];
    const pair = index ^ 1; // sibling
    if (pair < layer.length) proof.push("0x" + layer[pair].toString("hex"));
    else proof.push("0x" + layer[index].toString("hex")); // odd layer — self
    index = index >> 1;
  }
  return proof;
}

if (!fs.existsSync(INPUT)) {
  console.error(`No ${INPUT}. Create it with one 0x... address per line.`);
  process.exit(1);
}

const addrs = fs.readFileSync(INPUT, "utf-8")
  .split("\n")
  .map(s => s.trim())
  .filter(s => /^0x[0-9a-fA-F]{40}$/.test(s));

if (addrs.length === 0) {
  console.error("No valid addresses in whitelist.txt");
  process.exit(1);
}

console.log(`Building Merkle tree for ${addrs.length} addresses...`);

const leaves = addrs.map(leafForAddress);
const layers = buildTree(leaves);
const root = "0x" + layers[layers.length - 1][0].toString("hex");

const proofs = {};
addrs.forEach((addr, i) => {
  proofs[addr.toLowerCase()] = proofFor(layers, i);
});

const output = { root, count: addrs.length, proofs };
fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));

console.log(`\n✅ Merkle root: ${root}`);
console.log(`   Wrote proofs for ${addrs.length} addresses → ${OUTPUT}`);
console.log(`\nOn deploy: call spirits.setMerkleRoot("${root}")`);
