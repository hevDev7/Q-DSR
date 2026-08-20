// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title IERC7857
 * @notice The Agentic ID surface: transferring, cloning and delegating an AI agent
 *         together with its encrypted intelligence, rather than a pointer to it.
 *
 * Declared as `is IERC721` to match the draft. Solidity's `type(I).interfaceId`
 * excludes inherited functions, so the identifier still covers only the three
 * calls ERC-7857 adds — which is what a caller checking for Agentic ID support
 * wants to ask about.
 *
 * A block explorer that only knows the registered standards will label an
 * implementation ERC-721. That is not wrong, only less specific; declaring this
 * interface is what lets a contract or an indexer get the fuller answer.
 */
interface IERC7857 is IERC721 {
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

    /// @notice Emitted whenever the sealed metadata key for a token changes hands.
    event MetadataUpdated(uint256 indexed tokenId, bytes32 sealedKeyHash);

    /// @notice Emitted when an executor is granted the right to run an agent.
    event UsageAuthorized(uint256 indexed tokenId, address indexed executor);
}
