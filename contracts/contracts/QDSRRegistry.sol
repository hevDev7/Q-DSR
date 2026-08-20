// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOracle, IQDSRRegistry} from "./IQDSROracle.sol";

/**
 * @title QDSRRegistry
 * @notice On-chain record of statistical certification verdicts for AI trading agents.
 *
 * An agent's backtest is a hypothesis. This registry is the permanent record of
 * whether that hypothesis survived testing.
 *
 * Two design choices carry most of the weight:
 *
 * 1. The certification RULE lives on-chain. `submitVerdict` does not accept a
 *    boolean from the attestor — it derives `certified` from the submitted metrics
 *    against constants written into this contract. An attestor can be wrong about
 *    the numbers, but it cannot certify an agent that fails the published bar.
 *
 * 2. Verdicts are append-only. A failed verdict is never deleted or overwritten;
 *    re-verification pushes a new entry and the history stays queryable forever.
 *    That permanence is the product.
 */
contract QDSRRegistry is IOracle, IQDSRRegistry {
    // ---------------------------------------------------------------------
    // Certification thresholds — the published bar, enforced on-chain.
    // ---------------------------------------------------------------------

    /// @notice Deflated Sharpe Ratio must be at least 0.95 (p <= 0.05).
    uint32 public constant MIN_DSR_BPS = 9_500;
    /// @notice Probability of Backtest Overfitting must be at most 0.10.
    uint32 public constant MAX_PBO_BPS = 1_000;
    /// @notice At least one trading year of observations.
    uint32 public constant MIN_OBSERVATIONS = 252;
    /// @notice DSR is undefined for a single trial.
    uint32 public constant MIN_TRIALS = 2;

    uint32 private constant BPS_DENOMINATOR = 10_000;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Verdict {
        /// @dev 0G Storage merkle root of the evidence bundle and bootstrap artifacts.
        bytes32 evidenceRoot;
        /// @dev SHA-256 over the canonical numeric result — the reproducibility fingerprint.
        bytes32 resultDigest;
        /// @dev keccak256 of the engine version string that produced this result.
        bytes32 engineVersionHash;
        /// @dev Deflated Sharpe Ratio in basis points (0..10000).
        uint32 dsrBps;
        /// @dev Probability of Backtest Overfitting in basis points (0..10000).
        uint32 pboBps;
        /// @dev N — configurations explored during optimisation.
        uint32 trials;
        /// @dev T — return observations.
        uint32 observations;
        uint64 submittedAt;
        address attestor;
        bool certified;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public owner;
    mapping(address => bool) public isAttestor;
    mapping(bytes32 => Verdict[]) private _history;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event VerdictSubmitted(
        bytes32 indexed agentId,
        uint256 indexed index,
        bool certified,
        uint32 dsrBps,
        uint32 pboBps,
        bytes32 evidenceRoot,
        bytes32 resultDigest,
        string engineVersion
    );
    event AttestorUpdated(address indexed attestor, bool authorised);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotOwner();
    error NotAttestor();
    error ZeroAddress();
    error EmptyAgentId();
    error MissingEvidenceRoot();
    error MissingResultDigest();
    error MetricOutOfRange(uint32 value);
    error NoVerdict(bytes32 agentId);
    error IndexOutOfBounds(bytes32 agentId, uint256 index);
    error MalformedProof();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttestor() {
        if (!isAttestor[msg.sender]) revert NotAttestor();
        _;
    }

    constructor(address initialAttestor) {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);

        address attestor = initialAttestor == address(0) ? msg.sender : initialAttestor;
        isAttestor[attestor] = true;
        emit AttestorUpdated(attestor, true);
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    function setAttestor(address attestor, bool authorised) external onlyOwner {
        if (attestor == address(0)) revert ZeroAddress();
        isAttestor[attestor] = authorised;
        emit AttestorUpdated(attestor, authorised);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------------
    // Verdicts
    // ---------------------------------------------------------------------

    /**
     * @notice Records a verification result.
     * @dev `certified` is derived here, never supplied. The attestor reports
     *      measurements; this contract applies the rule.
     * @param agentId Stable agent identity, e.g. keccak256(owner, agentName).
     */
    function submitVerdict(
        bytes32 agentId,
        bytes32 evidenceRoot,
        bytes32 resultDigest,
        string calldata engineVersion,
        uint32 dsrBps,
        uint32 pboBps,
        uint32 trials,
        uint32 observations
    ) external onlyAttestor returns (uint256 index) {
        if (agentId == bytes32(0)) revert EmptyAgentId();
        if (evidenceRoot == bytes32(0)) revert MissingEvidenceRoot();
        if (resultDigest == bytes32(0)) revert MissingResultDigest();
        if (dsrBps > BPS_DENOMINATOR) revert MetricOutOfRange(dsrBps);
        if (pboBps > BPS_DENOMINATOR) revert MetricOutOfRange(pboBps);

        bool certified = dsrBps >= MIN_DSR_BPS &&
            pboBps <= MAX_PBO_BPS &&
            observations >= MIN_OBSERVATIONS &&
            trials >= MIN_TRIALS;

        Verdict memory verdict = Verdict({
            evidenceRoot: evidenceRoot,
            resultDigest: resultDigest,
            engineVersionHash: keccak256(bytes(engineVersion)),
            dsrBps: dsrBps,
            pboBps: pboBps,
            trials: trials,
            observations: observations,
            submittedAt: uint64(block.timestamp),
            attestor: msg.sender,
            certified: certified
        });

        _history[agentId].push(verdict);
        index = _history[agentId].length - 1;

        emit VerdictSubmitted(
            agentId,
            index,
            certified,
            dsrBps,
            pboBps,
            evidenceRoot,
            resultDigest,
            engineVersion
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function verdictCount(bytes32 agentId) external view returns (uint256) {
        return _history[agentId].length;
    }

    function verdictAt(bytes32 agentId, uint256 index) external view returns (Verdict memory) {
        if (index >= _history[agentId].length) revert IndexOutOfBounds(agentId, index);
        return _history[agentId][index];
    }

    function latestVerdict(bytes32 agentId) external view returns (Verdict memory) {
        uint256 length = _history[agentId].length;
        if (length == 0) revert NoVerdict(agentId);
        return _history[agentId][length - 1];
    }

    /// @notice True only if the agent's most recent verdict cleared every gate.
    function isCertified(bytes32 agentId) public view returns (bool) {
        uint256 length = _history[agentId].length;
        if (length == 0) return false;
        return _history[agentId][length - 1].certified;
    }

    /// @notice True if the agent has ever been recorded as statistically insignificant.
    function hasFailedVerdict(bytes32 agentId) external view returns (bool) {
        Verdict[] storage history = _history[agentId];
        for (uint256 i = 0; i < history.length; i++) {
            if (!history[i].certified) return true;
        }
        return false;
    }

    /**
     * @notice IOracle implementation — `proof` is an abi-encoded agentId.
     * @dev Lets any ERC-7857 contract that already speaks IOracle consult Q-DSR
     *      without knowing anything about this registry's wider surface.
     */
    function verifyProof(bytes calldata proof) external view returns (bool) {
        if (proof.length != 32) revert MalformedProof();
        return isCertified(abi.decode(proof, (bytes32)));
    }

    /// @notice Canonical agent identity derivation, exposed so clients cannot drift.
    function deriveAgentId(address agentOwner, string calldata agentName)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(agentOwner, agentName));
    }
}
