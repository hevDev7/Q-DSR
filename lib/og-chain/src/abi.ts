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
  // The append-only history is the part a third party audits, so a client library
  // that cannot read it back is only half a client.
  'function latestVerdict(bytes32 agentId) view returns (tuple(bytes32 evidenceRoot, bytes32 resultDigest, bytes32 engineVersionHash, uint32 dsrBps, uint32 pboBps, uint32 trials, uint32 observations, uint64 submittedAt, address attestor, bool certified))',
  'function verdictAt(bytes32 agentId, uint256 index) view returns (tuple(bytes32 evidenceRoot, bytes32 resultDigest, bytes32 engineVersionHash, uint32 dsrBps, uint32 pboBps, uint32 trials, uint32 observations, uint64 submittedAt, address attestor, bool certified))',
  'function owner() view returns (address)',
  'function deriveAgentId(address agentOwner, string agentName) pure returns (bytes32)',
  'function isAttestor(address) view returns (bool)',
  'function MIN_DSR_BPS() view returns (uint32)',
  'function MAX_PBO_BPS() view returns (uint32)',
  'event VerdictSubmitted(bytes32 indexed agentId, uint256 indexed index, bool certified, uint32 dsrBps, uint32 pboBps, bytes32 evidenceRoot, bytes32 resultDigest, string engineVersion)',
] as const;

export const AGENTIC_ID_ABI = [
  'function mint(address to, bytes32 agentId, (string name, string description, string image, string evidenceURI) metadata, bytes32 metadataHash) returns (uint256)',
  'function tokenIdOfAgent(bytes32 agentId) view returns (uint256)',
  'function isStillCertified(uint256 tokenId) view returns (bool)',
  'function totalMinted() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function metadataOf(uint256 tokenId) view returns (tuple(string name, string description, string image, string evidenceURI))',
  'function sealedKeyOf(uint256 tokenId) view returns (bytes)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function ERC7857_INTERFACE_ID() view returns (bytes4)',
  // What a token stands for. Without this a client can see that an Agentic ID
  // exists but not which agent, evidence or verdict it was minted against.
  'function recordOf(uint256 tokenId) view returns (tuple(bytes32 agentId, bytes32 metadataHash, uint256 verdictIndex, uint64 mintedAt))',
  'function authorisationOf(uint256 tokenId, address executor) view returns (bytes)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'event AgenticIdMinted(uint256 indexed tokenId, bytes32 indexed agentId, address indexed to, bytes32 metadataHash, string evidenceURI)',
  // Declared by ERC-7857 itself, so an indexer written against the standard finds them.
  'event MetadataUpdated(uint256 indexed tokenId, bytes32 sealedKeyHash)',
  'event UsageAuthorized(uint256 indexed tokenId, address indexed executor)',
  // Declared so a client can decode a revert into a name rather than raw bytes.
  // The blocked mint is the protocol's most important outcome; it deserves a
  // readable answer.
  'error AgentNotCertified(bytes32 agentId)',
  'error AgentAlreadyMinted(bytes32 agentId, uint256 tokenId)',
  'error ZeroAddress()',
  'error EmptyMetadata()',
  'error UnknownToken(uint256 tokenId)',
  'error NotTokenOwner(uint256 tokenId, address caller)',
] as const;
