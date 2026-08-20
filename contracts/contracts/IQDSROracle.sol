// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IOracle
 * @notice The verification hook that the ERC-7857 reference implementation already
 *         expects. Q-DSR implements this interface rather than inventing a parallel
 *         mechanism, so any ERC-7857 contract can plug in a Q-DSR registry without
 *         modification.
 */
interface IOracle {
    function verifyProof(bytes calldata proof) external view returns (bool);
}

/**
 * @title IQDSRRegistry
 * @notice Minimal surface an Agentic ID contract needs to gate minting.
 */
interface IQDSRRegistry {
    function isCertified(bytes32 agentId) external view returns (bool);

    /**
     * @notice The headline numbers of an agent's most recent verdict.
     * @dev A narrow view rather than the whole Verdict struct, so a consumer does
     *      not have to depend on the registry's storage layout to render a token.
     */
    function verdictMetrics(bytes32 agentId)
        external
        view
        returns (uint32 dsrBps, uint32 pboBps, uint32 trials, uint32 observations);
}
