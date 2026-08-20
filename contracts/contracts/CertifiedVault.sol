// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IQDSRRegistry} from "./IQDSROracle.sol";

/**
 * @title CertifiedVault
 * @notice A capital pool that only opens to agents holding a passing Q-DSR verdict.
 *
 *  This contract exists to demonstrate one thing: once certification lives on
 *  chain, gating capital on it is a single line —
 *
 *      if (!registry.isCertified(agentId)) revert AgentNotCertified(agentId);
 *
 *  No API, no signature from the operator, no trust in whoever runs the Q-DSR
 *  server. The registry derives every verdict from submitted metrics against
 *  constants compiled into it, and this vault reads that answer live.
 *
 *  Live matters. `isCertified` reflects the agent's LATEST verdict, so an agent
 *  that fails re-verification stops accepting deposits the moment its failing
 *  verdict lands — no pause switch, no admin intervention, nothing to revoke.
 *
 *  Two deliberate properties:
 *
 *  - The gate is on ALLOCATION, never on custody. Depositors can always withdraw
 *    their own funds, certified or not. A credential that could trap other
 *    people's money would be a rug primitive, not a trust primitive.
 *
 *  - There is no owner. Nothing here can be paused, upgraded, or pointed at a
 *    different registry. What you read is the whole contract.
 */
contract CertifiedVault is ReentrancyGuard {
    IQDSRRegistry public immutable registry;

    /// @notice Funds each depositor has allocated to each agent.
    mapping(bytes32 => mapping(address => uint256)) public balanceOf;
    /// @notice Total funds currently allocated to each agent.
    mapping(bytes32 => uint256) public totalAllocated;

    event Allocated(bytes32 indexed agentId, address indexed depositor, uint256 amount);
    event Withdrawn(bytes32 indexed agentId, address indexed depositor, uint256 amount);

    error AgentNotCertified(bytes32 agentId);
    error NothingToDeposit();
    error InsufficientBalance(uint256 requested, uint256 held);
    error TransferFailed();
    error ZeroAddress();

    constructor(address registryAddress) {
        if (registryAddress == address(0)) revert ZeroAddress();
        registry = IQDSRRegistry(registryAddress);
    }

    /**
     * @notice Allocates native funds to a certified agent.
     * @dev The whole point, in one require: the registry — not this contract, not
     *      any operator — decides whether the agent may take capital.
     */
    function deposit(bytes32 agentId) external payable {
        if (msg.value == 0) revert NothingToDeposit();
        if (!registry.isCertified(agentId)) revert AgentNotCertified(agentId);

        balanceOf[agentId][msg.sender] += msg.value;
        totalAllocated[agentId] += msg.value;

        emit Allocated(agentId, msg.sender, msg.value);
    }

    /**
     * @notice Withdraws the caller's own funds. Never gated on certification —
     *         the credential controls where new capital may flow, not whether
     *         existing capital may leave.
     */
    function withdraw(bytes32 agentId, uint256 amount) external nonReentrant {
        uint256 held = balanceOf[agentId][msg.sender];
        if (amount > held) revert InsufficientBalance(amount, held);

        balanceOf[agentId][msg.sender] = held - amount;
        totalAllocated[agentId] -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(agentId, msg.sender, amount);
    }

    /**
     * @notice Whether a deposit to this agent would be accepted right now, with
     *         the metrics a UI would want to show beside the answer.
     */
    function depositStatus(bytes32 agentId)
        external
        view
        returns (bool open, uint32 dsrBps, uint32 pboBps)
    {
        open = registry.isCertified(agentId);
        if (open) {
            (dsrBps, pboBps, , ) = registry.verdictMetrics(agentId);
        }
    }
}
