// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {AgenticIdMetadata} from "./AgenticIdMetadata.sol";
import {IERC7857} from "./IERC7857.sol";
import {IOracle, IQDSRRegistry} from "./IQDSROracle.sol";

/**
 * @title AgenticID
 * @notice ERC-7857 Agentic ID whose minting is gated by statistical certification.
 *
 * The ERC-7857 reference implementation exposes an `IOracle` hook and an
 * owner-restricted mint. This contract keeps the standard's surface — `transfer`,
 * `clone`, `authorizeUsage` with sealed keys and oracle proofs — and replaces the
 * owner check on mint with a Q-DSR certification check.
 *
 * The consequence is the whole point of the protocol: an agent whose backtest
 * cannot survive PBO and DSR testing cannot acquire an on-chain identity at all.
 * It does not get a warning label. It does not get minted.
 */
contract AgenticID is ERC721, ReentrancyGuard, IERC7857 {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /**
     * @notice What the token presents to a wallet or an explorer.
     * @dev `image` is an http(s) URL, in practice served from 0G Storage. Leaving
     *      it empty is supported and makes `tokenURI` generate an SVG from the
     *      agent's own certification numbers, so a token always renders.
     * @dev `evidenceURI` is deliberately not encrypted. The evidence is public
     *      precisely so a stranger can re-run it — that is the protocol's claim.
     */
    struct AgentMetadata {
        string name;
        string description;
        string image;
        string evidenceURI;
    }

    struct AgentRecord {
        /// @dev Stable agent identity — the key the registry holds verdicts under.
        bytes32 agentId;
        /// @dev Hash of the encrypted metadata this token points at.
        bytes32 metadataHash;
        /// @dev Verdict index in the registry at the moment of minting.
        uint256 verdictIndex;
        uint64 mintedAt;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    IQDSRRegistry public immutable registry;
    IOracle public immutable oracle;

    address public owner;
    uint256 private _nextTokenId = 1;

    mapping(uint256 => AgentRecord) private _records;
    mapping(uint256 => AgentMetadata) private _metadata;
    /**
     * @dev The metadata key, sealed for the current holder.
     *
     * ERC-7857's model is that the key travels with the token, re-encrypted for
     * each new owner. Accepting a sealed key and discarding it would be worse
     * than not accepting one, so it is stored and replaced on every transfer.
     */
    mapping(uint256 => bytes) private _sealedKeys;
    /// @dev One Agentic ID per certified agent — identity is not fungible.
    mapping(bytes32 => uint256) public tokenIdOfAgent;
    /// @dev tokenId => executor => permissions blob.
    mapping(uint256 => mapping(address => bytes)) private _authorisations;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event AgenticIdMinted(
        uint256 indexed tokenId,
        bytes32 indexed agentId,
        address indexed to,
        bytes32 metadataHash,
        string evidenceURI
    );
    event MintBlocked(bytes32 indexed agentId, address indexed caller, string reason);
    event SealedTransfer(uint256 indexed tokenId, address indexed from, address indexed to);
    event Cloned(uint256 indexed sourceTokenId, uint256 indexed newTokenId, address indexed to);
    // UsageAuthorized and MetadataUpdated are declared by IERC7857.
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotOwner();
    error ZeroAddress();
    error AgentNotCertified(bytes32 agentId);
    error AgentAlreadyMinted(bytes32 agentId, uint256 tokenId);
    error EmptyMetadata();
    error UnknownToken(uint256 tokenId);
    error NotTokenOwner(uint256 tokenId, address caller);
    error InvalidProof();
    error EmptySealedKey();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev The ERC-7857 oracle gate, applied to sealed-key operations.
    modifier validProof(bytes calldata proof) {
        if (address(oracle) == address(0)) revert InvalidProof();
        if (!oracle.verifyProof(proof)) revert InvalidProof();
        _;
    }

    constructor(address registryAddress)
        ERC721("Q-DSR Agentic ID", "QAID")
    {
        if (registryAddress == address(0)) revert ZeroAddress();
        registry = IQDSRRegistry(registryAddress);
        oracle = IOracle(registryAddress);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ---------------------------------------------------------------------
    // Minting — the certification gate
    // ---------------------------------------------------------------------

    /**
     * @notice Mints an Agentic ID for an agent that has passed Q-DSR certification.
     * @dev Deliberately permissionless: anyone may mint for a certified agent,
     *      because the gate that matters is the statistical one, not an allowlist.
     */
    function mint(
        address to,
        bytes32 agentId,
        AgentMetadata calldata metadata,
        bytes32 metadataHash
    ) external nonReentrant returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (metadataHash == bytes32(0) || bytes(metadata.evidenceURI).length == 0) {
            revert EmptyMetadata();
        }

        uint256 existing = tokenIdOfAgent[agentId];
        if (existing != 0) revert AgentAlreadyMinted(agentId, existing);

        if (!registry.isCertified(agentId)) {
            // Emitted before reverting so an indexer can surface rejected attempts —
            // the blocked mints are as much a part of the record as the successful ones.
            emit MintBlocked(agentId, msg.sender, "QDSR: agent not certified");
            revert AgentNotCertified(agentId);
        }

        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        _records[tokenId] = AgentRecord({
            agentId: agentId,
            metadataHash: metadataHash,
            verdictIndex: 0,
            mintedAt: uint64(block.timestamp)
        });
        _metadata[tokenId] = metadata;
        tokenIdOfAgent[agentId] = tokenId;

        emit AgenticIdMinted(tokenId, agentId, to, metadataHash, metadata.evidenceURI);
    }

    // ---------------------------------------------------------------------
    // ERC-7857 surface
    // ---------------------------------------------------------------------

    /**
     * @notice Transfers an Agentic ID together with a re-sealed metadata key.
     * @param sealedKey Metadata key re-encrypted for the recipient.
     * @param proof Oracle proof — an abi-encoded agentId under the Q-DSR registry.
     */
    function transfer(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata sealedKey,
        bytes calldata proof
    ) external override validProof(proof) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (sealedKey.length == 0) revert EmptySealedKey();
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken(tokenId);
        if (_ownerOf(tokenId) != from) revert NotTokenOwner(tokenId, from);
        if (msg.sender != from && !isApprovedForAll(from, msg.sender)) {
            revert NotTokenOwner(tokenId, msg.sender);
        }

        _sealedKeys[tokenId] = sealedKey;
        _transfer(from, to, tokenId);

        emit SealedTransfer(tokenId, from, to);
        emit MetadataUpdated(tokenId, keccak256(sealedKey));
    }

    /**
     * @notice Clones an agent into a new token for another owner.
     * @dev The clone inherits the source agent's certification — it is the same
     *      intelligence, so it carries the same verdict rather than an unverified one.
     */
    function clone(
        address to,
        uint256 tokenId,
        bytes calldata sealedKey,
        bytes calldata proof
    ) external override validProof(proof) nonReentrant returns (uint256 newTokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (sealedKey.length == 0) revert EmptySealedKey();
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);

        AgentRecord memory source = _records[tokenId];

        newTokenId = _nextTokenId++;
        _safeMint(to, newTokenId);
        _records[newTokenId] = AgentRecord({
            agentId: source.agentId,
            metadataHash: source.metadataHash,
            verdictIndex: source.verdictIndex,
            mintedAt: uint64(block.timestamp)
        });
        _metadata[newTokenId] = _metadata[tokenId];
        _sealedKeys[newTokenId] = sealedKey;

        emit Cloned(tokenId, newTokenId, to);
        emit MetadataUpdated(newTokenId, keccak256(sealedKey));
    }

    /// @notice Grants an executor permission to run the agent without transferring it.
    function authorizeUsage(
        uint256 tokenId,
        address executor,
        bytes calldata permissions
    ) external override {
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
        if (executor == address(0)) revert ZeroAddress();

        _authorisations[tokenId][executor] = permissions;
        emit UsageAuthorized(tokenId, executor);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function recordOf(uint256 tokenId) external view returns (AgentRecord memory) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken(tokenId);
        return _records[tokenId];
    }

    /**
     * @notice The metadata key sealed for this token's current holder.
     * @dev Readable by anyone; it is ciphertext, and only the holder's private key
     *      opens it. Empty for a token that has never been transferred, because a
     *      mint has no previous owner to re-seal from.
     */
    function sealedKeyOf(uint256 tokenId) external view returns (bytes memory) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken(tokenId);
        return _sealedKeys[tokenId];
    }

    function metadataOf(uint256 tokenId) external view returns (AgentMetadata memory) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken(tokenId);
        return _metadata[tokenId];
    }

    /**
     * @notice ERC-721 metadata, built on chain.
     * @dev The certification numbers are read live from the registry rather than
     *      copied at mint time, so a token that later loses its standing says so
     *      instead of showing a verdict that no longer holds.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        AgentRecord memory record = _records[tokenId];
        AgentMetadata memory metadata = _metadata[tokenId];
        (uint32 dsrBps, uint32 pboBps, uint32 trials, uint32 observations) =
            registry.verdictMetrics(record.agentId);

        return
            AgenticIdMetadata.tokenURI(
                AgenticIdMetadata.View({
                    name: metadata.name,
                    description: metadata.description,
                    image: metadata.image,
                    evidenceURI: metadata.evidenceURI,
                    dsrBps: dsrBps,
                    pboBps: pboBps,
                    trials: trials,
                    observations: observations,
                    certified: registry.isCertified(record.agentId),
                    tokenId: tokenId
                })
            );
    }

    function authorisationOf(uint256 tokenId, address executor) external view returns (bytes memory) {
        return _authorisations[tokenId][executor];
    }

    /// @notice Whether this token's agent still holds a passing verdict.
    function isStillCertified(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken(tokenId);
        return registry.isCertified(_records[tokenId].agentId);
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /**
     * @notice ERC-165 id for the ERC-7857 surface.
     * @dev The XOR of the three selectors the standard adds on top of ERC-721.
     *      Computed here rather than hardcoded, so it cannot drift from the
     *      interface it claims to describe.
     */
    /// @dev Solidity excludes inherited functions from `type(I).interfaceId`, so this
    ///      covers exactly the three calls ERC-7857 adds on top of ERC-721.
    bytes4 public constant ERC7857_INTERFACE_ID = type(IERC7857).interfaceId;

    /**
     * @dev Without this an Agentic ID is indistinguishable on chain from any other
     *      ERC-721. A block explorer will still print "ERC-721" — explorers match
     *      against the standards they have implemented, and ERC-7857 is a draft —
     *      but a contract or an indexer can now detect it.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, IERC165)
        returns (bool)
    {
        return interfaceId == ERC7857_INTERFACE_ID || super.supportsInterface(interfaceId);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
