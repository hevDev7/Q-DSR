/**
 * Minimal QDSRRegistry ABI.
 *
 * Declared here rather than imported from the Hardhat build output so the API
 * server does not need the contracts package compiled in order to start. The
 * fragments below are the whole surface the server uses; the contract tests are
 * what keep them honest.
 */
export const QDSR_REGISTRY_ABI = [
  'function submitVerdict(bytes32 agentId, bytes32 evidenceRoot, bytes32 resultDigest, string engineVersion, uint32 dsrBps, uint32 pboBps, uint32 trials, uint32 observations) returns (uint256)',
  'function isCertified(bytes32 agentId) view returns (bool)',
  'function hasFailedVerdict(bytes32 agentId) view returns (bool)',
  'function verdictCount(bytes32 agentId) view returns (uint256)',
  'function deriveAgentId(address agentOwner, string agentName) pure returns (bytes32)',
  'function isAttestor(address) view returns (bool)',
  'function MIN_DSR_BPS() view returns (uint32)',
  'function MAX_PBO_BPS() view returns (uint32)',
  'event VerdictSubmitted(bytes32 indexed agentId, uint256 indexed index, bool certified, uint32 dsrBps, uint32 pboBps, bytes32 evidenceRoot, bytes32 resultDigest, string engineVersion)',
] as const;

export const AGENTIC_ID_ABI = [
  'function mint(address to, bytes32 agentId, string metadataURI, bytes32 metadataHash) returns (uint256)',
  'function tokenIdOfAgent(bytes32 agentId) view returns (uint256)',
  'function isStillCertified(uint256 tokenId) view returns (bool)',
  'function totalMinted() view returns (uint256)',
  'event AgenticIdMinted(uint256 indexed tokenId, bytes32 indexed agentId, address indexed to, bytes32 metadataHash, string metadataURI)',
] as const;
