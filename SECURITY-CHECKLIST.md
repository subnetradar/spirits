# Security Self-Audit Checklist — SubnetSpirits

Manual verification before mainnet deploy. Work through each item.

## 🔑 Access Control

- [x] `onlyOwner` on: `setPhase`, `setMerkleRoot`, `setUnrevealedURI`, `reveal`, `setBaseURI`, `freezeMetadata`, `setMarketplaceFee`, `pauseMarketplace`, `unpauseMarketplace`, `withdrawMintProceeds`
- [x] `Ownable2Step` used (two-step ownership transfer)
- [ ] **Deploy-time**: transfer ownership to **Gnosis Safe multi-sig** (min 2-of-3)
- [ ] **Deploy-time**: add **24h Timelock** on critical setters (setBaseURI, withdraw)

## 💰 Payment Safety

- [x] Strict equality on mint payment (`msg.value == price * quantity`)
- [x] Pull-payment pattern for marketplace sales (no push-payment DoS)
- [x] `totalPending` invariant protects user funds from owner withdrawal
- [x] `nonReentrant` on all state-changing payable functions
- [x] No direct `.transfer()` or `.send()` — all external calls use `.call{value:}`

## 🔄 Reentrancy

- [x] ReentrancyGuard on `whitelistMint`, `publicMint`, `buy`, `withdrawPending`, `withdrawMintProceeds`
- [x] CEI pattern: state updated before external calls in `buy`
- [x] `_safeMint` in loops is safe (outer nonReentrant blocks reentry)

## 📜 Provenance & Reveal

- [x] `provenanceHash` is immutable
- [x] Constructor rejects zero hash + empty URI
- [x] `reveal()` verifies `keccak256(seed, mappingHash) == provenanceHash`
- [x] `reveal()` requires `phase == Closed` (grind-proof)
- [x] Mint functions require `!revealed`
- [x] `revealed` is one-way (can't un-reveal)
- [x] `setPhase` blocks re-opening after reveal
- [x] `freezeMetadata()` makes `setBaseURI` permanently unavailable

## 🎲 Mint Fairness

- [x] Flat price for all tokens (no tier-sniping)
- [x] Sequential tokenIds (no gaps, predictable)
- [x] Per-wallet caps (5 WL, 20 public) limit concentration
- [x] `MAX_PER_TX = 10` bounds loop gas
- [x] Whitelist Merkle-leaf format documented: `keccak256(abi.encodePacked(sender))`

## 🏪 Marketplace

- [x] Only token owner can list
- [x] Approval required before listing
- [x] Listing auto-clears on any transfer (`_update` override)
- [x] Listing overwrite emits `Delisted` for old listing
- [x] `whenNotPaused` on `list` and `buy` (emergency kill switch)
- [x] `delist` requires seller match
- [x] `marketplaceFee <= 10%` enforced
- [x] Royalty (5%) via EIP-2981 (off-marketplace respect varies)

## 📝 Events

- [x] `Minted` on each mint
- [x] `Listed` / `Delisted` / `Sold` on marketplace actions
- [x] `Revealed` with seed+hash on reveal
- [x] `PhaseChanged`, `MerkleRootUpdated`, `MarketplaceFeeUpdated`, `UnrevealedURIUpdated`, `BaseURIUpdated`, `MetadataFrozen`
- [x] `PendingWithdrawalQueued`, `Withdrawn` on pull-payment flow

## 🧱 Integer Safety

- [x] Solidity 0.8.24 (built-in overflow checks)
- [x] `unchecked { totalMinted++ }` safe under `totalMinted + quantity <= MAX_SUPPLY` guard
- [x] No user-controlled values that could overflow in `price * quantity` (MAX_PER_TX × price is tiny)

## 🧪 Testing

- [x] 45 unit tests passing
- [x] 100% line coverage
- [x] 100% function coverage
- [x] 81% branch coverage
- [ ] Invariant tests (nice-to-have: Foundry fuzz)

## 🔍 Static Analysis

- [x] **Slither**: 0 High, 0 Medium (12 informational, all acceptable)
- [x] **Solhint**: 0 security warnings (NatSpec-style only)
- [ ] Mythril (blocked by local Python 3.14 — consider Docker)
- [ ] Echidna (optional, Haskell install needed)

## 🚨 Known Centralization Risks

(Inherent; not bugs — must be managed operationally)

- **Owner can change `baseURI` after reveal** (until `freezeMetadata()`)
  - Mitigation: Multi-sig + Timelock. Call `freezeMetadata()` within 7-14 days post-reveal.
- **Owner can change `merkleRoot` before reveal**
  - Mitigation: Multi-sig. Announce root publicly before whitelist mint opens.
- **Owner can change `unrevealedURI` before reveal**
  - Mitigation: Multi-sig. Low impact (just placeholder).
- **Owner receives royalties**
  - Mitigation: Set owner to SubnetRadar treasury multi-sig, not personal EOA.

## 🌐 Off-chain Dependencies

- [ ] Arweave upload of metadata directory (1030 JSON files)
- [ ] Arweave upload of masters (1030 × 48MB = ~50GB)
- [ ] R2 CDN mirror set up
- [ ] `subnetradar.com/spirits/img/*.png` proxy worker live
- [ ] Revealed mapping.json published at known URL
- [ ] Seed published at reveal time (was kept secret during mint)

## 🏁 Pre-mainnet Checklist

- [ ] Multi-sig deployed (Gnosis Safe on Bittensor EVM)
- [ ] Contract deployed on testnet
- [ ] At least 10 test-mints on testnet successful
- [ ] Test reveal flow end-to-end on testnet
- [ ] Test marketplace list/buy/withdraw flow on testnet
- [ ] Community post on Bittensor Discord + OpenZeppelin forum (≥7 days)
- [ ] Terms of Service published on subnetradar.com/spirits
- [ ] Non-investment disclaimer prominent on mint UI
- [ ] Emergency response plan documented (pause, multi-sig coordination)
