/**
 * Deploy script for SubnetSpirits.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network bittensorTestnet
 *   npx hardhat run scripts/deploy.js --network bittensorMainnet
 *
 * Expects in provenance/:
 *   - hash.txt  (provenanceHash, 0x-prefixed bytes32)
 *
 * Expects env:
 *   - UNREVEALED_URI  (IPFS / Arweave URI for mystery egg placeholder)
 */

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const ROOT = path.join(__dirname, "..");
  const provenancePath = path.join(ROOT, "provenance", "hash.txt");

  if (!fs.existsSync(provenancePath)) {
    throw new Error(`Missing ${provenancePath}. Run 'node scripts/build-provenance.js' first.`);
  }

  const provenanceHash = fs.readFileSync(provenancePath, "utf-8").trim();
  const unrevealedURI = process.env.UNREVEALED_URI;

  if (!unrevealedURI) throw new Error("Set UNREVEALED_URI env var (egg placeholder URI)");
  if (!/^0x[0-9a-fA-F]{64}$/.test(provenanceHash)) {
    throw new Error(`Bad provenanceHash format: ${provenanceHash}`);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`Network:       ${network.name}`);
  console.log(`Deployer:      ${deployer.address}`);
  console.log(`Balance:       ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} TAO`);
  console.log(`provenance:    ${provenanceHash}`);
  console.log(`unrevealedURI: ${unrevealedURI}`);

  if (network.name === "bittensorMainnet") {
    console.log("\n⚠️  MAINNET DEPLOY — sleeping 10s for you to abort (Ctrl-C)");
    await new Promise(r => setTimeout(r, 10_000));
  }

  const Factory = await ethers.getContractFactory("SubnetSpirits");
  const spirits = await Factory.deploy(unrevealedURI, provenanceHash);
  await spirits.waitForDeployment();

  const addr = await spirits.getAddress();
  console.log(`\n✅ Deployed SubnetSpirits at ${addr}`);

  const outPath = path.join(ROOT, "deployments", `${network.name}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    network: network.name,
    address: addr,
    deployer: deployer.address,
    provenanceHash,
    unrevealedURI,
    deployedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`   Deployment info → ${outPath}`);

  console.log(`\nNext steps:`);
  console.log(`  1. Verify:       npx hardhat verify --network ${network.name} ${addr} "${unrevealedURI}" ${provenanceHash}`);
  console.log(`  2. Transfer ownership → Gnosis Safe multi-sig`);
  console.log(`  3. Set Merkle root:  spirits.setMerkleRoot(<root from build-merkle.js>)`);
  console.log(`  4. Open whitelist:   spirits.setPhase(1)`);
  console.log(`  5. Open public:      spirits.setPhase(2)`);
  console.log(`  6. Close + reveal:   setPhase(0), then reveal(baseURI, seed, mappingHash)`);
  console.log(`  7. Eventually:       freezeMetadata()`);
}

main().catch((err) => { console.error(err); process.exit(1); });
