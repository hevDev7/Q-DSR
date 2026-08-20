// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC7857
 * @notice The Agentic ID surface: transferring, cloning and delegating an AI agent
 *         together with its encrypted intelligence, rather than a pointer to it.
 *
 * ERC-7857 is a draft that extends ERC-721. A contract implementing it answers
 * `supportsInterface` for ERC-721 as well, which is why a block explorer that only
 * knows the registered standards will label it ERC-721 — that label is not wrong,
 * it is just less specific than the truth.
 *
 * Declaring this interface is what lets another contract or an indexer detect an
 * Agentic ID programmatically instead of inferring it from a name.
 */
interface IERC7857 {
    /// @notice Transfers an agent along with its metadata key, re-sealed for the recipient.
    function transfer(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata sealedKey,
        bytes calldata proof
    ) external;

    /// @notice Copies an agent into a new token for another owner.
    function clone(
        address to,
        uint256 tokenId,
        bytes calldata sealedKey,
        bytes calldata proof
    ) external returns (uint256 newTokenId);

    /// @notice Grants an executor permission to run the agent without transferring it.
    function authorizeUsage(
        uint256 tokenId,
        address executor,
        bytes calldata permissions
    ) external;
}
