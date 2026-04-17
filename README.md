# Subnet Spirits

A 1050-piece sponsor edition ERC-721 collection on **Bittensor EVM** that funds
ongoing development of [SubnetRadar.com](https://subnetradar.com).

> **This is not an investment.** Subnet Spirits is a sponsor edition. 100% of
> proceeds fund SubnetRadar operations — hosting, development, ecosystem
> contributions. Holders are sponsors, not speculators.

## What's here

This repo contains the smart-contract code, tests, and deployment scripts for
community review before mainnet deploy. Nothing here is yet deployed.

```
contracts/SubnetSpirits.sol   ← the contract (399 lines, Solidity 0.8.24)
test/SubnetSpirits.test.js    ← 58 unit tests, 100% line coverage
scripts/deploy.js             ← deploy script
scripts/build-provenance.js   ← builds the fair-mint commitment
scripts/build-merkle.js       ← builds whitelist Merkle tree
hardhat.config.js             ← Cancun EVM, Solidity 0.8.24 pinned
SECURITY-CHECKLIST.md         ← manual audit items
COMMUNITY-REVIEW.md           ← review-request posts
```

## Design highlights

- **Blind mint** — Sequential tokenIds 1..1050, random (netuid, variant)
  assignment via pre-committed shuffle.
- **Provenance-verified reveal** —
  `provenanceHash = keccak256(abi.encodePacked(seed, keccak256(mapping.json)))`
  is immutable at deploy. `reveal()` requires matching seed+mappingHash.
- **Grind-proof** — Mint closes automatically once revealed.
- **Pull-payment marketplace** — Sellers withdraw their own funds via
  `withdrawPending()`. Prevents seller-contract grief vectors.
- **Auto-delist on transfer** — `_update()` override clears listings on any
  transfer path.
- **Metadata freeze** — `freezeMetadata()` permanently locks `baseURI` post-reveal.
- **Two-step ownership** — `Ownable2Step`. Multi-sig deployment recommended.
- **Pausable marketplace** — emergency kill-switch for list/buy.
- **EIP-2981 royalty** — 5% on secondary.
- **Merkle whitelist** — `keccak256(abi.encodePacked(sender))` leaf.

## Parameters

| | Value |
|---|---|
| Max supply | 1050 |
| Public price | 0.05 TAO |
| Whitelist price | 0.03 TAO |
| Max per tx | 10 |
| Max per WL wallet | 5 |
| Max per public wallet | 10 |
| Marketplace fee | 2.5% (owner-adjustable, capped at 10%) |
| Royalty | 5% |

## Running locally

```bash
npm install
npx hardhat compile        # clean under Cancun EVM
npx hardhat test           # 58 passing
npx hardhat coverage       # 100% lines, 100% functions
```

Static analysis:
```bash
# Slither (pip install slither-analyzer)
slither . --filter-paths "node_modules"

# Solhint
npx solhint 'contracts/**/*.sol'
```

## Security status

| Check | Result |
|---|---|
| Unit tests | 58 passing, 100% line coverage, 81% branch |
| Slither | 0 High, 0 Medium (12 informational, all naming/style) |
| Solhint | 0 security warnings |
| External audit | pending — community review in progress |
| Immunefi bounty | going live at mainnet deploy |

See [SECURITY-CHECKLIST.md](./SECURITY-CHECKLIST.md) for the full pre-deploy checklist.

## Community review

See [COMMUNITY-REVIEW.md](./COMMUNITY-REVIEW.md) for what we'd love eyes on.
In short: especially the reveal-verification, pull-payment marketplace,
Merkle-whitelist leaf format, and the `_update()` auto-delist.

Reporting:
- **Non-critical**: open a GitHub issue
- **Critical/high-severity**: email `subnetradar@proton.me` or DM
  [@SubnetRadarBot](https://t.me/SubnetRadarBot). Responsible disclosure
  appreciated.

## License

MIT. See `contracts/SubnetSpirits.sol` header.

## Links

- Landing: https://subnetradar.com/spirits
- Treasury: https://subnetradar.com/spirits/treasury
- Provenance: https://subnetradar.com/spirits/provenance
- Terms: https://subnetradar.com/spirits/terms
