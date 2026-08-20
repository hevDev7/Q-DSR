// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IAgenticIdProbe {
    struct AgentRecord {
        bytes32 agentId;
        bytes32 metadataHash;
        uint256 verdictIndex;
        uint64 mintedAt;
    }

    function recordOf(uint256 tokenId) external view returns (AgentRecord memory);

    function tokenIdOfAgent(bytes32 agentId) external view returns (uint256);
}

/**
 * @dev Reads the token back out of AgenticID from inside `onERC721Received`.
 *
 * A receiver runs while the mint is still in progress. If AgenticID writes its
 * records after `_safeMint`, everything this contract observes here is zero —
 * which is exactly what a real integrator (a vault, a marketplace escrow, a
 * staking contract) would index and store.
 */
contract StateProbeReceiver is IERC721Receiver {
    bytes32 public seenAgentId;
    uint256 public seenReverseLookup;
    bool public probed;

    function onERC721Received(address, address, uint256 tokenId, bytes calldata)
        external
        override
        returns (bytes4)
    {
        IAgenticIdProbe agentic = IAgenticIdProbe(msg.sender);
        IAgenticIdProbe.AgentRecord memory record = agentic.recordOf(tokenId);

        seenAgentId = record.agentId;
        seenReverseLookup = agentic.tokenIdOfAgent(record.agentId);
        probed = true;

        return IERC721Receiver.onERC721Received.selector;
    }
}
