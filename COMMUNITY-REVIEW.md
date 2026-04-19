# Community Review Posts

Copy-paste material for the code-review phase. Customize the GitHub link once the repo is public.

---

## 1. Twitter/X post (thread)

**Tweet 1**
> Subnet Spirits — Sponsor Edition 🐉
>
> A 1050-NFT collectible drop on Bittensor EVM that funds ongoing development
> of SubnetRadar. Contract is open for community review before we deploy.
>
> Would love eyes on the Solidity 👇
> github.com/subnetradar/spirits

**Tweet 2**
> What it is:
> - ERC-721 on Bittensor EVM
> - Blind mint (random tokenId → subnet/variant)
> - Provenance-verified fair shuffle (keccak256 commit)
> - Delayed reveal, grind-proof
> - Pull-payment marketplace
> - 5% royalty, 2.5% market fee
>
> All proceeds → SubnetRadar multi-sig treasury.

**Tweet 3**
> What we'd love feedback on:
> 1. reveal() provenance verification
> 2. Pull-payment pattern in buy() / withdrawPending()
> 3. Merkle-whitelist leaf format
> 4. _update() override auto-delisting
> 5. Any centralization risk we missed
>
> 58 unit tests, 100% line coverage, Slither clean.

**Tweet 4**
> Not an investment — this is a sponsor edition. Every TAO funds servers,
> development, and ecosystem contributions. Terms + treasury transparency
> at subnetradar.com/spirits
>
> Tag a Solidity auditor who might want to take a look 🙏

---

## 2. OpenZeppelin Forum post

**Title**: `[Code review] Subnet Spirits — Blind-mint NFT on Bittensor EVM, provenance-verified fair shuffle`

**Body**:
```markdown
Hi all,

We're about to deploy a 1050-NFT collectible drop on Bittensor EVM (a new
EVM chain) and would really appreciate a set of fresh eyes on the Solidity
before we commit anything on mainnet.

The collection is a **sponsor edition** — 100% of proceeds fund operations
of SubnetRadar.com (a free analytics platform for Bittensor). Non-profit
in intent; we're treating this as a hobby project with serious security
expectations.

**Contract**: https://github.com/subnetradar/spirits/blob/main/contracts/SubnetSpirits.sol
(399 lines, Solidity 0.8.24, OpenZeppelin base)

**Key design choices** we'd love feedback on:

1. **Provenance-verified blind mint**
   Pre-commit hash of shuffled mapping on-chain. `reveal()` requires owner
   to submit matching seed+mappingHash. Any misalignment reverts.
   ```solidity
   require(
     keccak256(abi.encodePacked(_seed, _mappingHash)) == provenanceHash,
     "Bad provenance"
   );
   ```

2. **Pull-payment marketplace**
   Sellers don't receive funds via `.call` during `buy()`. Instead funds
   accumulate in `pendingWithdrawals[seller]` and `seller` calls
   `withdrawPending()`. Prevents griefing.

3. **`_update()` auto-delist**
   Listings clear automatically on any transfer (mint, buy, or direct
   transferFrom). Prevents stale listings.

4. **totalPending invariant**
   `withdrawMintProceeds` subtracts `totalPending` from balance so owner
   can never touch user-owed funds.

5. **Grind-proof**
   Mint functions require `!revealed`. `reveal()` requires `phase == Closed`.
   Impossible to mint after reveal.

6. **Merkle whitelist**
   Leaf format: `keccak256(abi.encodePacked(msg.sender))`. Sorted-pair tree.

**Testing**:
- 58 unit tests, 100% line coverage, 81% branch coverage
- Slither: 0 High/Medium findings
- Solhint: 0 security warnings

**Known centralization risks** (documented, managed operationally via
multi-sig + timelock): baseURI mutability until `freezeMetadata()`,
merkleRoot before reveal, unrevealedURI before reveal, owner receives
royalties.

**What I'm looking for**:
- Economic attack vectors I missed
- Reentrancy surfaces outside the obvious
- Edge cases in reveal/freeze lifecycle
- Gas-griefing opportunities in batch mint
- Anything that looks off

Happy to answer any questions about design tradeoffs. Thanks in advance 🙏
```

---

## 3. Bittensor Discord post

In `#dev` or `#nft` channel:

```
gm devs 👋

Dropping a 1050-NFT sponsor edition on Bittensor EVM soon — 100% of
proceeds fund SubnetRadar operations.

Contract is up for community review before deploy:
https://github.com/subnetradar/spirits

Would love any Solidity-fluent folks to take 15 min and poke at it.
Especially interested in:
- Provenance-verified blind mint + reveal flow
- Pull-payment marketplace
- Anything Bittensor-EVM-specific I might've missed

58 tests passing, Slither clean, but fresh eyes always catch things.

Thanks in advance 🙏
```

---

## 4. r/ethdev post

**Title**: `Looking for feedback on a 400-line ERC-721 with blind-mint + pull-payment marketplace`

**Body**:
```markdown
Hi /r/ethdev,

Deploying a 1050-NFT collection on Bittensor EVM (EVM-compatible chain
in the Bittensor ecosystem). Contract is finalized, 58 tests passing,
Slither clean, would love community review before we commit.

Project is a **sponsor edition** — not for profit, proceeds fund a
free analytics tool. ~€30-50K max exposure. Hobby-scale but trying
to be serious about security.

**Repo**: https://github.com/subnetradar/spirits

**Highlights**:
- ERC-721 + EIP-2981 royalty
- Blind mint with on-chain provenance hash (`keccak256(seed, mappingHash)`)
- Delayed reveal, grind-proof
- Built-in marketplace with pull-payment + auto-delist on `_update()`
- OpenZeppelin base (Ownable2Step, Pausable, ReentrancyGuard, MerkleProof)

**Specific things I'm unsure about**:
- Is the provenance-commitment scheme ironclad? I hash (seed ++ mappingHash)
  and verify on reveal.
- Does the pull-payment + totalPending invariant fully protect user funds
  from owner withdraw?
- Any gas-griefing in `_mintMany` that I missed?

Full design doc inside. Happy to answer questions.
```

---

## 5. GitHub README excerpt

Add to README.md under a "Security Review" heading:

```markdown
## Security Review

This contract is open for community review before mainnet deploy.

**In-scope**: `contracts/SubnetSpirits.sol` (399 lines)

**Not in scope**: OpenZeppelin imports (audited separately), off-chain
scripts (`scripts/*`), UI code.

**Current status**:
- ✅ 58 unit tests passing, 100% line coverage
- ✅ Slither: 0 High/Medium findings
- ✅ Solhint: 0 security warnings
- ⏳ Community review: in progress

**Reporting issues**:
- Non-critical: open a GitHub issue
- Critical/high-severity: please email subnetradar@proton.me or DM on
  Telegram @SubnetRadarBot. Responsible disclosure appreciated.

**Bounty** (rough rates, symbolic — this is a sponsor edition, not a funded protocol):
- Critical (drain funds / rug path): €50+
- High (lock funds / griefing): €25+
- Medium: €10+
- Informational: gratitude
```

---

## Timing suggestion

1. **Day 0**: Post Twitter + Bittensor Discord + OZ forum simultaneously
2. **Day 3**: Bump the posts, respond to feedback
3. **Day 7**: Post on r/ethdev (reddit peak traffic)
4. **Day 10**: Summarize findings, incorporate fixes
5. **Day 14**: Testnet deploy
6. **Day 21**: Mainnet deploy
