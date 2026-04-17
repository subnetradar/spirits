// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * Subnet Spirits — SubnetRadar Sponsor Edition.
 *
 * A 1000-piece collectible series that funds the ongoing development and
 * hosting of SubnetRadar.com — an open intelligence layer for the Bittensor
 * ecosystem. Mint proceeds are allocated to infrastructure, development,
 * and ecosystem contributions. Holders are sponsors, not speculators.
 *
 * Technical:
 *   - 1000 NFTs, randomly assigned (tokenId → netuid/variant) via an
 *     off-chain pre-shuffled mapping committed on-chain as `provenanceHash`.
 *   - Flat mint price: 0.1 TAO public, 0.075 TAO whitelist
 *   - Delayed reveal with on-chain provenance verification
 *   - Mint closes automatically once revealed (grind-proof)
 *   - Metadata can be frozen permanently after reveal
 *   - Pull-payment marketplace (list/delist/buy) with 2.5% fee
 *   - 5% EIP-2981 royalty on secondary sales → also funds SubnetRadar
 *   - Two-step ownership + pausable marketplace + reentrancy-guarded
 *
 * @dev Burn is not supported. `totalMinted` is the permanent high-water mark.
 */
contract SubnetSpirits is ERC721, Ownable2Step, ReentrancyGuard, Pausable {
    using Strings for uint256;

    // ─── Mission (immutable on-chain declaration) ──────────
    string public constant MISSION =
        "Subnet Spirits funds the ongoing development and hosting of "
        "SubnetRadar.com. Proceeds cover infrastructure, development, "
        "and ecosystem contributions. Holders are sponsors, not speculators. "
        "The Spirit is a collectible token of appreciation, not an investment.";

    // ─── Config (immutable post-deploy) ─────────────────────
    uint256 public constant MAX_SUPPLY           = 1050;
    uint256 public constant PUBLIC_PRICE         = 0.05  ether; // 0.05 TAO sponsor price
    uint256 public constant WHITELIST_PRICE      = 0.03  ether; // 0.03 TAO early-sponsor price
    uint256 public constant MAX_PER_TX           = 10;
    uint256 public constant MAX_PER_WL_WALLET    = 5;
    uint256 public constant MAX_PER_PUBLIC_WALLET = 10;
    uint256 public constant ROYALTY_BPS          = 500;  // 5%
    uint256 public constant MARKETPLACE_FEE_MAX  = 1000; // 10%

    // ─── Phase ──────────────────────────────────────────────
    enum Phase { Closed, Whitelist, Public }
    Phase public phase = Phase.Closed;

    // ─── Mint state ─────────────────────────────────────────
    uint256 public totalMinted;
    mapping(address => uint256) public whitelistMinted;
    mapping(address => uint256) public publicMinted;

    // ─── Whitelist (Merkle) ─────────────────────────────────
    bytes32 public merkleRoot;

    // ─── Reveal & Provenance ────────────────────────────────
    bool    public revealed;
    bool    public metadataFrozen;
    string  public unrevealedURI;
    string  public baseURI;

    /// @notice keccak256(abi.encodePacked(seed, mappingHash)) — committed at deploy.
    /// @dev On reveal, owner must submit matching seed+mappingHash.
    bytes32 public immutable provenanceHash;

    /// @notice Revealed publicly once reveal() is called (previously secret).
    bytes32 public revealedSeed;
    bytes32 public revealedMappingHash;

    // ─── Marketplace ────────────────────────────────────────
    struct Listing {
        address seller;
        uint256 price;
        bool    active;
    }
    mapping(uint256 => Listing) public listings;
    uint256 public marketplaceFee = 250; // bps (2.5%)

    /// @notice Pull-payment balances. Sellers / refunds call `withdrawPending`.
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice Running total of user-owed balances. Ensures `withdrawMintProceeds`
    /// can never touch funds earmarked for sellers or refunds.
    uint256 public totalPending;

    // ─── Events ─────────────────────────────────────────────
    event Minted(address indexed minter, uint256 indexed tokenId, uint256 price, Phase phase);
    event PhaseChanged(Phase newPhase);
    event MerkleRootUpdated(bytes32 newRoot);
    event UnrevealedURIUpdated(string newURI);
    event Revealed(string baseURI, bytes32 seed, bytes32 mappingHash);
    event BaseURIUpdated(string newURI);
    event MetadataFrozen();
    event MarketplaceFeeUpdated(uint256 newFeeBps);
    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Delisted(uint256 indexed tokenId);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee);
    event PendingWithdrawalQueued(address indexed account, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    // ─── Constructor ────────────────────────────────────────
    constructor(
        string memory _unrevealedURI,
        bytes32 _provenanceHash
    )
        ERC721("Subnet Spirits", "SPIRIT")
        Ownable(msg.sender)
    {
        require(bytes(_unrevealedURI).length > 0, "Empty unrevealedURI");
        require(_provenanceHash != bytes32(0), "Empty provenanceHash");
        unrevealedURI  = _unrevealedURI;
        provenanceHash = _provenanceHash;
    }

    // ═══ Mint ═══════════════════════════════════════════════

    /// @notice Whitelist mint — Merkle-proof gated, grind-proof.
    function whitelistMint(uint256 quantity, bytes32[] calldata proof)
        external
        payable
        nonReentrant
    {
        require(!revealed, "Mint closed after reveal");
        require(phase == Phase.Whitelist, "Whitelist not active");
        require(quantity > 0 && quantity <= MAX_PER_TX, "Invalid quantity");
        require(totalMinted + quantity <= MAX_SUPPLY, "Exceeds supply");
        require(
            whitelistMinted[msg.sender] + quantity <= MAX_PER_WL_WALLET,
            "Exceeds WL wallet cap"
        );
        require(msg.value == WHITELIST_PRICE * quantity, "Wrong payment");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
        require(MerkleProof.verify(proof, merkleRoot, leaf), "Not whitelisted");

        whitelistMinted[msg.sender] += quantity;
        _mintMany(quantity, WHITELIST_PRICE);
    }

    /// @notice Public mint — open to anyone; wallet-capped.
    function publicMint(uint256 quantity) external payable nonReentrant {
        require(!revealed, "Mint closed after reveal");
        require(phase == Phase.Public, "Public not active");
        require(quantity > 0 && quantity <= MAX_PER_TX, "Invalid quantity");
        require(totalMinted + quantity <= MAX_SUPPLY, "Exceeds supply");
        require(
            publicMinted[msg.sender] + quantity <= MAX_PER_PUBLIC_WALLET,
            "Exceeds public wallet cap"
        );
        require(msg.value == PUBLIC_PRICE * quantity, "Wrong payment");

        publicMinted[msg.sender] += quantity;
        _mintMany(quantity, PUBLIC_PRICE);
    }

    function _mintMany(uint256 quantity, uint256 price) internal {
        for (uint256 i = 0; i < quantity; i++) {
            unchecked { totalMinted++; }
            uint256 tokenId = totalMinted; // 1..MAX_SUPPLY sequential
            _safeMint(msg.sender, tokenId);
            emit Minted(msg.sender, tokenId, price, phase);
        }
    }

    // ═══ Metadata ═══════════════════════════════════════════

    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        _requireOwned(tokenId);
        if (!revealed) return unrevealedURI;
        return string(abi.encodePacked(baseURI, "/", tokenId.toString()));
    }

    // ═══ Marketplace (P2P, pull-payment) ════════════════════

    function list(uint256 tokenId, uint256 price)
        external
        whenNotPaused
    {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        require(price > 0, "Price must be > 0");
        require(
            getApproved(tokenId) == address(this) || isApprovedForAll(msg.sender, address(this)),
            "Approve marketplace first"
        );

        // If overwriting an existing active listing, signal it was delisted.
        if (listings[tokenId].active) {
            emit Delisted(tokenId);
        }
        listings[tokenId] = Listing({ seller: msg.sender, price: price, active: true });
        emit Listed(tokenId, msg.sender, price);
    }

    function delist(uint256 tokenId) external {
        Listing storage lst = listings[tokenId];
        require(lst.seller == msg.sender, "Not your listing");
        require(lst.active, "Not listed");
        lst.active = false;
        emit Delisted(tokenId);
    }

    /// @notice Buy a listed NFT. Funds go to pull-payment balances (no direct send).
    function buy(uint256 tokenId)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        Listing memory item = listings[tokenId];
        require(item.active, "Not for sale");
        require(msg.value >= item.price, "Insufficient payment");

        uint256 fee          = (item.price * marketplaceFee) / 10000;
        uint256 sellerAmount = item.price - fee;

        // Effects
        listings[tokenId].active = false;
        pendingWithdrawals[item.seller] += sellerAmount;
        totalPending += sellerAmount;
        if (msg.value > item.price) {
            uint256 refund = msg.value - item.price;
            pendingWithdrawals[msg.sender] += refund;
            totalPending += refund;
            emit PendingWithdrawalQueued(msg.sender, refund);
        }
        emit PendingWithdrawalQueued(item.seller, sellerAmount);

        // Interaction
        _transfer(item.seller, msg.sender, tokenId);

        emit Sold(tokenId, item.seller, msg.sender, item.price, fee);
    }

    /// @notice Withdraw any sale proceeds or refunds owed to msg.sender.
    function withdrawPending() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        totalPending -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Paginated view of active listings. Use `offset + limit` for large pages.
    function getActiveListings(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, uint256[] memory prices)
    {
        require(limit > 0 && limit <= 500, "Bad limit");
        uint256 end = offset + limit;
        if (end > MAX_SUPPLY) end = MAX_SUPPLY;

        // First pass: count
        uint256 count;
        for (uint256 i = offset + 1; i <= end; i++) {
            if (listings[i].active) count++;
        }
        // Second pass: fill
        ids    = new uint256[](count);
        prices = new uint256[](count);
        uint256 idx;
        for (uint256 i = offset + 1; i <= end; i++) {
            if (listings[i].active) {
                ids[idx]    = i;
                prices[idx] = listings[i].price;
                idx++;
            }
        }
    }

    /// @notice Auto-clear any active listing when the token moves (mint/transfer/burn).
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        if (listings[tokenId].active) {
            listings[tokenId].active = false;
            emit Delisted(tokenId);
        }
        return super._update(to, tokenId, auth);
    }

    // ═══ Owner-only ═════════════════════════════════════════

    function setPhase(Phase _phase) external onlyOwner {
        require(!revealed || _phase == Phase.Closed, "Cannot reopen mint after reveal");
        phase = _phase;
        emit PhaseChanged(_phase);
    }

    function setMerkleRoot(bytes32 _root) external onlyOwner {
        require(!revealed, "Too late");
        merkleRoot = _root;
        emit MerkleRootUpdated(_root);
    }

    function setUnrevealedURI(string calldata _uri) external onlyOwner {
        require(!revealed, "Already revealed");
        require(bytes(_uri).length > 0, "Empty URI");
        unrevealedURI = _uri;
        emit UnrevealedURIUpdated(_uri);
    }

    /// @notice Reveal metadata + prove commitment. Closes mint permanently.
    function reveal(
        string calldata _baseURI,
        bytes32 _seed,
        bytes32 _mappingHash
    )
        external
        onlyOwner
    {
        require(!revealed, "Already revealed");
        require(phase == Phase.Closed, "Close mint first");
        require(bytes(_baseURI).length > 0, "Empty baseURI");
        require(
            keccak256(abi.encodePacked(_seed, _mappingHash)) == provenanceHash,
            "Bad provenance"
        );
        revealed            = true;
        revealedSeed        = _seed;
        revealedMappingHash = _mappingHash;
        baseURI             = _baseURI;
        emit Revealed(_baseURI, _seed, _mappingHash);
    }

    /// @notice Update baseURI post-reveal (e.g. CDN migration). Blocked once frozen.
    function setBaseURI(string calldata _uri) external onlyOwner {
        require(revealed, "Not revealed yet");
        require(!metadataFrozen, "Metadata frozen");
        require(bytes(_uri).length > 0, "Empty URI");
        baseURI = _uri;
        emit BaseURIUpdated(_uri);
    }

    /// @notice Permanently lock baseURI. One-way.
    function freezeMetadata() external onlyOwner {
        require(revealed, "Not revealed yet");
        require(!metadataFrozen, "Already frozen");
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    function setMarketplaceFee(uint256 _fee) external onlyOwner {
        require(_fee <= MARKETPLACE_FEE_MAX, "Max 10%");
        marketplaceFee = _fee;
        emit MarketplaceFeeUpdated(_fee);
    }

    function pauseMarketplace() external onlyOwner { _pause(); }
    function unpauseMarketplace() external onlyOwner { _unpause(); }

    /// @notice Owner withdraws contract balance (mint proceeds). Pull-payment
    /// balances (`pendingWithdrawals`) are excluded — they belong to users.
    function withdrawMintProceeds(address to) external onlyOwner nonReentrant {
        require(to != address(0), "Bad recipient");
        uint256 balance = address(this).balance;
        require(balance > totalPending, "No mint proceeds");
        uint256 withdrawable = balance - totalPending;
        (bool ok, ) = to.call{value: withdrawable}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(to, withdrawable);
    }

    // ═══ Royalties (EIP-2981) ═══════════════════════════════

    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        returns (address, uint256)
    {
        return (owner(), (salePrice * ROYALTY_BPS) / 10000);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override
        returns (bool)
    {
        return interfaceId == 0x2a55205a || super.supportsInterface(interfaceId);
    }
}
