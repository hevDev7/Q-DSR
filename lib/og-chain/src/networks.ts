/** 0G network parameters. */
export interface OgNetwork {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerBaseUrl: string;
  currency: string;
}

export const OG_MAINNET: OgNetwork = {
  chainId: 16661,
  name: '0G mainnet',
  rpcUrl: 'https://evmrpc.0g.ai',
  explorerBaseUrl: 'https://chainscan.0g.ai',
  currency: '0G',
};

export const OG_TESTNET: OgNetwork = {
  chainId: 16602,
  name: '0G Galileo testnet',
  rpcUrl: 'https://evmrpc-testnet.0g.ai',
  explorerBaseUrl: 'https://chainscan-galileo.0g.ai',
  currency: '0G',
};

export const OG_NETWORKS: Record<number, OgNetwork> = {
  [OG_MAINNET.chainId]: OG_MAINNET,
  [OG_TESTNET.chainId]: OG_TESTNET,
};

export function networkForChainId(chainId: number): OgNetwork | undefined {
  return OG_NETWORKS[chainId];
}
