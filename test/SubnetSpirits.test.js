const { expect } = require("chai");
const { ethers } = require("hardhat");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

const Phase = { Closed: 0, Whitelist: 1, Public: 2 };

describe("SubnetSpirits", function () {
  let spirits, owner, alice, bob, carol, eve;
  let seed, mappingHash, provenanceHash;

  const UNREVEALED_URI = "ipfs://QmEgg/egg.json";
  const BASE_URI = "https://subnetradar.com/spirits/metadata";

  async function deployFixture() {
    [owner, alice, bob, carol, eve] = await ethers.getSigners();

    // Build provenance commitment.
    seed         = ethers.keccak256(ethers.toUtf8Bytes("test-seed"));
    mappingHash  = ethers.keccak256(ethers.toUtf8Bytes('{"tokenId":1,"netuid":1}'));
    provenanceHash = ethers.keccak256(
      ethers.solidityPacked(["bytes32", "bytes32"], [seed, mappingHash])
    );

    const Factory = await ethers.getContractFactory("SubnetSpirits");
    spirits = await Factory.deploy(UNREVEALED_URI, provenanceHash);
    await spirits.waitForDeployment();
  }

  beforeEach(deployFixture);

  // ─── Deployment ──────────────────────────────────────
  describe("Deployment", function () {
    it("sets name, symbol, mission, provenance", async () => {
      expect(await spirits.name()).to.equal("Subnet Spirits");
      expect(await spirits.symbol()).to.equal("SPIRIT");
      expect(await spirits.MISSION()).to.include("SubnetRadar");
      expect(await spirits.provenanceHash()).to.equal(provenanceHash);
      expect(await spirits.unrevealedURI()).to.equal(UNREVEALED_URI);
      expect(await spirits.phase()).to.equal(Phase.Closed);
    });

    it("rejects empty unrevealedURI", async () => {
      const F = await ethers.getContractFactory("SubnetSpirits");
      await expect(F.deploy("", provenanceHash)).to.be.revertedWith("Empty unrevealedURI");
    });

    it("rejects zero provenance hash", async () => {
      const F = await ethers.getContractFactory("SubnetSpirits");
      await expect(F.deploy(UNREVEALED_URI, ethers.ZeroHash))
        .to.be.revertedWith("Empty provenanceHash");
    });

    it("correctly priced constants", async () => {
      expect(await spirits.PUBLIC_PRICE()).to.equal(ethers.parseEther("0.05"));
      expect(await spirits.WHITELIST_PRICE()).to.equal(ethers.parseEther("0.03"));
      expect(await spirits.MAX_SUPPLY()).to.equal(1050n);
    });
  });

  // ─── Access control ──────────────────────────────────
  describe("Access control", function () {
    it("only owner can setPhase", async () => {
      await expect(spirits.connect(alice).setPhase(Phase.Public))
        .to.be.revertedWithCustomError(spirits, "OwnableUnauthorizedAccount");
    });

    it("only owner can reveal", async () => {
      await expect(spirits.connect(alice).reveal(BASE_URI, seed, mappingHash))
        .to.be.revertedWithCustomError(spirits, "OwnableUnauthorizedAccount");
    });

    it("only owner can pause marketplace", async () => {
      await expect(spirits.connect(alice).pauseMarketplace())
        .to.be.revertedWithCustomError(spirits, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Public mint ─────────────────────────────────────
  describe("publicMint", function () {
    beforeEach(async () => spirits.setPhase(Phase.Public));

    it("mints at correct price", async () => {
      const price = ethers.parseEther("0.05");
      await expect(spirits.connect(alice).publicMint(1, { value: price }))
        .to.emit(spirits, "Minted")
        .withArgs(alice.address, 1n, price, Phase.Public);
      expect(await spirits.ownerOf(1)).to.equal(alice.address);
      expect(await spirits.totalMinted()).to.equal(1n);
    });

    it("reverts on wrong price", async () => {
      await expect(spirits.connect(alice).publicMint(1, { value: ethers.parseEther("0.04") }))
        .to.be.revertedWith("Wrong payment");
    });

    it("reverts on zero quantity", async () => {
      await expect(spirits.connect(alice).publicMint(0, { value: 0 }))
        .to.be.revertedWith("Invalid quantity");
    });

    it("reverts when over MAX_PER_TX", async () => {
      const price = ethers.parseEther("0.05") * 11n;
      await expect(spirits.connect(alice).publicMint(11, { value: price }))
        .to.be.revertedWith("Invalid quantity");
    });

    it("enforces MAX_PER_PUBLIC_WALLET", async () => {
      const price = ethers.parseEther("0.05") * 10n;
      // 10 is the cap (same as MAX_PER_TX)
      await spirits.connect(alice).publicMint(10, { value: price });
      await expect(spirits.connect(alice).publicMint(1, { value: ethers.parseEther("0.05") }))
        .to.be.revertedWith("Exceeds public wallet cap");
    });

    it("reverts when phase != Public", async () => {
      await spirits.setPhase(Phase.Closed);
      await expect(spirits.connect(alice).publicMint(1, { value: ethers.parseEther("0.05") }))
        .to.be.revertedWith("Public not active");
    });

    it("reverts after reveal", async () => {
      await spirits.setPhase(Phase.Closed);
      await spirits.reveal(BASE_URI, seed, mappingHash);
      await spirits.setPhase(Phase.Public).catch(() => {}); // blocked; ignore
      await expect(spirits.connect(alice).publicMint(1, { value: ethers.parseEther("0.05") }))
        .to.be.revertedWith("Mint closed after reveal");
    });

    it("sequential tokenIds", async () => {
      const p = ethers.parseEther("0.05") * 3n;
      await spirits.connect(alice).publicMint(3, { value: p });
      expect(await spirits.ownerOf(1)).to.equal(alice.address);
      expect(await spirits.ownerOf(2)).to.equal(alice.address);
      expect(await spirits.ownerOf(3)).to.equal(alice.address);
    });
  });

  // ─── Whitelist mint ──────────────────────────────────
  describe("whitelistMint", function () {
    let tree, proofAlice, proofBob;

    beforeEach(async () => {
      const values = [[alice.address], [bob.address], [carol.address]];
      tree = StandardMerkleTree.of(values, ["address"]);
      const leafAlice = ethers.keccak256(ethers.solidityPacked(["address"], [alice.address]));
      // Use keccak(address) as leaf (matches contract)
      // Build a simpler proof manually — the contract uses keccak256(abi.encodePacked(sender))
      // StandardMerkleTree uses its own double-hash. Replace with ad-hoc tree to match.
      const leaves = [alice, bob, carol].map(a => ethers.keccak256(ethers.solidityPacked(["address"], [a.address])));
      // Single-level sorted tree (3 leaves → pad to 4)
      const pad = ethers.ZeroHash;
      const sortedPair = (a, b) => a < b
        ? ethers.keccak256(ethers.concat([a, b]))
        : ethers.keccak256(ethers.concat([b, a]));
      const h01 = sortedPair(leaves[0], leaves[1]);
      const h23 = sortedPair(leaves[2], pad);
      const root = sortedPair(h01, h23);

      proofAlice = [leaves[1], h23];
      proofBob   = [leaves[0], h23];

      await spirits.setMerkleRoot(root);
      await spirits.setPhase(Phase.Whitelist);
    });

    it("mints with valid proof", async () => {
      const price = ethers.parseEther("0.03");
      await expect(spirits.connect(alice).whitelistMint(1, proofAlice, { value: price }))
        .to.emit(spirits, "Minted");
      expect(await spirits.ownerOf(1)).to.equal(alice.address);
    });

    it("rejects with wrong proof", async () => {
      const price = ethers.parseEther("0.03");
      await expect(spirits.connect(eve).whitelistMint(1, proofAlice, { value: price }))
        .to.be.revertedWith("Not whitelisted");
    });

    it("enforces MAX_PER_WL_WALLET (5)", async () => {
      const p = ethers.parseEther("0.03") * 5n;
      await spirits.connect(alice).whitelistMint(5, proofAlice, { value: p });
      await expect(
        spirits.connect(alice).whitelistMint(1, proofAlice, { value: ethers.parseEther("0.03") })
      ).to.be.revertedWith("Exceeds WL wallet cap");
    });

    it("reverts after reveal", async () => {
      await spirits.setPhase(Phase.Closed);
      await spirits.reveal(BASE_URI, seed, mappingHash);
      await expect(
        spirits.connect(alice).whitelistMint(1, proofAlice, { value: ethers.parseEther("0.03") })
      ).to.be.revertedWith("Mint closed after reveal");
    });
  });

  // ─── Reveal & provenance ─────────────────────────────
  describe("Reveal", function () {
    it("reveal with correct commitment works", async () => {
      await expect(spirits.reveal(BASE_URI, seed, mappingHash))
        .to.emit(spirits, "Revealed")
        .withArgs(BASE_URI, seed, mappingHash);
      expect(await spirits.revealed()).to.equal(true);
      expect(await spirits.baseURI()).to.equal(BASE_URI);
      expect(await spirits.revealedSeed()).to.equal(seed);
      expect(await spirits.revealedMappingHash()).to.equal(mappingHash);
    });

    it("reveal with wrong seed reverts", async () => {
      const badSeed = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
      await expect(spirits.reveal(BASE_URI, badSeed, mappingHash))
        .to.be.revertedWith("Bad provenance");
    });

    it("reveal with wrong mappingHash reverts", async () => {
      const badMapping = ethers.keccak256(ethers.toUtf8Bytes("not the mapping"));
      await expect(spirits.reveal(BASE_URI, seed, badMapping))
        .to.be.revertedWith("Bad provenance");
    });

    it("reveal blocks if phase != Closed", async () => {
      await spirits.setPhase(Phase.Public);
      await expect(spirits.reveal(BASE_URI, seed, mappingHash))
        .to.be.revertedWith("Close mint first");
    });

    it("cannot reveal twice", async () => {
      await spirits.reveal(BASE_URI, seed, mappingHash);
      await expect(spirits.reveal(BASE_URI, seed, mappingHash))
        .to.be.revertedWith("Already revealed");
    });

    it("setPhase cannot re-open mint after reveal", async () => {
      await spirits.reveal(BASE_URI, seed, mappingHash);
      await expect(spirits.setPhase(Phase.Public))
        .to.be.revertedWith("Cannot reopen mint after reveal");
    });
  });

  // ─── tokenURI ─────────────────────────────────────────
  describe("tokenURI", function () {
    beforeEach(async () => spirits.setPhase(Phase.Public));

    it("returns unrevealedURI before reveal", async () => {
      await spirits.connect(alice).publicMint(1, { value: ethers.parseEther("0.05") });
      expect(await spirits.tokenURI(1)).to.equal(UNREVEALED_URI);
    });

    it("returns baseURI/tokenId after reveal", async () => {
      await spirits.connect(alice).publicMint(1, { value: ethers.parseEther("0.05") });
      await spirits.setPhase(Phase.Closed);
      await spirits.reveal(BASE_URI, seed, mappingHash);
      expect(await spirits.tokenURI(1)).to.equal(`${BASE_URI}/1`);
    });

    it("reverts for non-existent token", async () => {
      await expect(spirits.tokenURI(999))
        .to.be.revertedWithCustomError(spirits, "ERC721NonexistentToken");
    });
  });

  // ─── Metadata freeze ──────────────────────────────────
  describe("Metadata freeze", function () {
    beforeEach(async () => {
      await spirits.reveal(BASE_URI, seed, mappingHash);
    });

    it("setBaseURI works before freeze", async () => {
      await spirits.setBaseURI("https://other.example/meta");
      expect(await spirits.baseURI()).to.equal("https://other.example/meta");
    });

    it("freeze blocks setBaseURI", async () => {
      await spirits.freezeMetadata();
      await expect(spirits.setBaseURI("https://hacker.example/meta"))
        .to.be.revertedWith("Metadata frozen");
    });

    it("cannot freeze twice", async () => {
      await spirits.freezeMetadata();
      await expect(spirits.freezeMetadata()).to.be.revertedWith("Already frozen");
    });

    it("cannot freeze before reveal", async () => {
      const F = await ethers.getContractFactory("SubnetSpirits");
      const fresh = await F.deploy(UNREVEALED_URI, provenanceHash);
      await expect(fresh.freezeMetadata()).to.be.revertedWith("Not revealed yet");
    });
  });

  // ─── Marketplace ──────────────────────────────────────
  describe("Marketplace", function () {
    beforeEach(async () => {
      await spirits.setPhase(Phase.Public);
      await spirits.connect(alice).publicMint(2, { value: ethers.parseEther("0.05") * 2n });
      await spirits.connect(alice).approve(spirits.target, 1);
    });

    it("list and buy works (pull payment)", async () => {
      const listPrice = ethers.parseEther("1");
      await expect(spirits.connect(alice).list(1, listPrice))
        .to.emit(spirits, "Listed");
      await expect(spirits.connect(bob).buy(1, { value: listPrice }))
        .to.emit(spirits, "Sold");

      // Token transferred
      expect(await spirits.ownerOf(1)).to.equal(bob.address);

      // Seller has pending withdrawal (minus fee)
      const fee = listPrice * 250n / 10000n;
      const expected = listPrice - fee;
      expect(await spirits.pendingWithdrawals(alice.address)).to.equal(expected);

      // Seller can withdraw
      await expect(() => spirits.connect(alice).withdrawPending())
        .to.changeEtherBalance(alice, expected);
      expect(await spirits.pendingWithdrawals(alice.address)).to.equal(0n);
    });

    it("overpayment queues refund for buyer", async () => {
      const listPrice = ethers.parseEther("1");
      await spirits.connect(alice).list(1, listPrice);
      await spirits.connect(bob).buy(1, { value: listPrice + ethers.parseEther("0.5") });
      expect(await spirits.pendingWithdrawals(bob.address))
        .to.equal(ethers.parseEther("0.5"));
    });

    it("buy reverts if underpaid", async () => {
      await spirits.connect(alice).list(1, ethers.parseEther("1"));
      await expect(spirits.connect(bob).buy(1, { value: ethers.parseEther("0.5") }))
        .to.be.revertedWith("Insufficient payment");
    });

    it("delist works", async () => {
      await spirits.connect(alice).list(1, ethers.parseEther("1"));
      await expect(spirits.connect(alice).delist(1)).to.emit(spirits, "Delisted");
      await expect(spirits.connect(bob).buy(1, { value: ethers.parseEther("1") }))
        .to.be.revertedWith("Not for sale");
    });

    it("transfer clears listing automatically", async () => {
      await spirits.connect(alice).list(1, ethers.parseEther("1"));
      await expect(spirits.connect(alice).transferFrom(alice.address, carol.address, 1))
        .to.emit(spirits, "Delisted");
      const listing = await spirits.listings(1);
      expect(listing.active).to.equal(false);
    });

    it("pause blocks list and buy", async () => {
      await spirits.pauseMarketplace();
      await expect(spirits.connect(alice).list(1, ethers.parseEther("1")))
        .to.be.revertedWithCustomError(spirits, "EnforcedPause");
    });

    it("list overwrite emits Delisted for old listing", async () => {
      await spirits.connect(alice).list(1, ethers.parseEther("1"));
      await expect(spirits.connect(alice).list(1, ethers.parseEther("2")))
        .to.emit(spirits, "Delisted")
        .and.to.emit(spirits, "Listed");
    });
  });

  // ─── Withdraw mint proceeds ──────────────────────────
  describe("Withdraw mint proceeds", function () {
    it("owner withdraws mint revenue but not user-owed funds", async () => {
      await spirits.setPhase(Phase.Public);
      const price = ethers.parseEther("0.05");
      await spirits.connect(alice).publicMint(2, { value: price * 2n });
      await spirits.connect(alice).approve(spirits.target, 1);
      await spirits.connect(alice).list(1, ethers.parseEther("1"));
      await spirits.connect(bob).buy(1, { value: ethers.parseEther("1") });

      const salePrice = ethers.parseEther("1");
      const marketFee = salePrice * 250n / 10000n;
      const expectedProceeds = (price * 2n) + marketFee; // mint revenue + 2.5% fee
      const ownerStart = await ethers.provider.getBalance(owner.address);

      const tx = await spirits.withdrawMintProceeds(owner.address);
      const rcpt = await tx.wait();
      const gas  = rcpt.gasUsed * rcpt.gasPrice;

      const ownerEnd = await ethers.provider.getBalance(owner.address);
      expect(ownerEnd - ownerStart + gas).to.equal(expectedProceeds);

      // Seller funds untouched
      expect(await spirits.pendingWithdrawals(alice.address))
        .to.equal(ethers.parseEther("1") - (ethers.parseEther("1") * 250n / 10000n));
    });

    it("cannot withdraw if no proceeds", async () => {
      await expect(spirits.withdrawMintProceeds(owner.address))
        .to.be.revertedWith("No mint proceeds");
    });

    it("rejects zero address", async () => {
      await expect(spirits.withdrawMintProceeds(ethers.ZeroAddress))
        .to.be.revertedWith("Bad recipient");
    });
  });

  // ─── Royalty ──────────────────────────────────────────
  describe("Royalty (EIP-2981)", function () {
    it("returns 5% royalty to owner", async () => {
      const [recipient, amount] = await spirits.royaltyInfo(1, ethers.parseEther("1"));
      expect(recipient).to.equal(owner.address);
      expect(amount).to.equal(ethers.parseEther("0.05"));
    });

    it("supportsInterface returns true for EIP-2981", async () => {
      expect(await spirits.supportsInterface("0x2a55205a")).to.equal(true);
    });

    it("supportsInterface returns true for ERC721", async () => {
      expect(await spirits.supportsInterface("0x80ac58cd")).to.equal(true);
    });
  });

  // ─── Extra owner setters ─────────────────────────────
  describe("Owner setters", function () {
    it("setUnrevealedURI updates and emits", async () => {
      await expect(spirits.setUnrevealedURI("ipfs://Qm/new.json"))
        .to.emit(spirits, "UnrevealedURIUpdated");
      expect(await spirits.unrevealedURI()).to.equal("ipfs://Qm/new.json");
    });

    it("setUnrevealedURI rejects empty and post-reveal", async () => {
      await expect(spirits.setUnrevealedURI("")).to.be.revertedWith("Empty URI");
      await spirits.reveal(BASE_URI, seed, mappingHash);
      await expect(spirits.setUnrevealedURI("ipfs://new"))
        .to.be.revertedWith("Already revealed");
    });

    it("setMarketplaceFee accepts ≤10% and emits", async () => {
      await expect(spirits.setMarketplaceFee(500))
        .to.emit(spirits, "MarketplaceFeeUpdated").withArgs(500);
      expect(await spirits.marketplaceFee()).to.equal(500n);
    });

    it("setMarketplaceFee rejects >10%", async () => {
      await expect(spirits.setMarketplaceFee(1001)).to.be.revertedWith("Max 10%");
    });

    it("pause / unpause flow", async () => {
      await spirits.pauseMarketplace();
      expect(await spirits.paused()).to.equal(true);
      await spirits.unpauseMarketplace();
      expect(await spirits.paused()).to.equal(false);
    });

    it("setMerkleRoot blocked after reveal", async () => {
      await spirits.reveal(BASE_URI, seed, mappingHash);
      await expect(spirits.setMerkleRoot(ethers.ZeroHash)).to.be.revertedWith("Too late");
    });

    it("setBaseURI rejects empty", async () => {
      await spirits.reveal(BASE_URI, seed, mappingHash);
      await expect(spirits.setBaseURI("")).to.be.revertedWith("Empty URI");
    });

    it("setBaseURI blocked before reveal", async () => {
      await expect(spirits.setBaseURI("foo")).to.be.revertedWith("Not revealed yet");
    });

    it("reveal rejects empty baseURI", async () => {
      await expect(spirits.reveal("", seed, mappingHash)).to.be.revertedWith("Empty baseURI");
    });

    it("withdrawPending reverts when nothing to withdraw", async () => {
      await expect(spirits.connect(alice).withdrawPending())
        .to.be.revertedWith("Nothing to withdraw");
    });
  });

  // ─── Paginated listings ──────────────────────────────
  describe("getActiveListings pagination", function () {
    it("returns active listings in range", async () => {
      await spirits.setPhase(Phase.Public);
      await spirits.connect(alice).publicMint(3, { value: ethers.parseEther("0.05") * 3n });
      await spirits.connect(alice).setApprovalForAll(spirits.target, true);
      await spirits.connect(alice).list(1, ethers.parseEther("1"));
      await spirits.connect(alice).list(3, ethers.parseEther("2"));

      const [ids, prices] = await spirits.getActiveListings(0, 10);
      expect(ids).to.have.lengthOf(2);
      expect(ids[0]).to.equal(1n);
      expect(ids[1]).to.equal(3n);
      expect(prices[0]).to.equal(ethers.parseEther("1"));
      expect(prices[1]).to.equal(ethers.parseEther("2"));
    });

    it("rejects bad limit", async () => {
      await expect(spirits.getActiveListings(0, 0)).to.be.revertedWith("Bad limit");
      await expect(spirits.getActiveListings(0, 501)).to.be.revertedWith("Bad limit");
    });

    it("clamps end to MAX_SUPPLY", async () => {
      const [ids] = await spirits.getActiveListings(2000, 500);
      expect(ids).to.have.lengthOf(0);
    });
  });
});
