import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  dataDir: string;
  databaseUrl?: string;
  storage: {
    indexerRpc?: string;
    evmRpc?: string;
    privateKey?: string;
    cacheDir: string;
  };
  chain: {
    rpcUrl?: string;
    chainId?: number;
    privateKey?: string;
    registryAddress?: string;
    agenticIdAddress?: string;
  };
  defaults: {
    bootstrapIterations: number;
    cscvSplits: number;
    seed: number;
  };
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function numeric(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reads configuration from the environment.
 *
 * Everything 0G-related is optional on purpose. The server must start and the
 * whole verification workflow must run with nothing configured, so that a
 * reviewer can clone the repo and see it work before any credentials exist.
 * What changes without configuration is only where the evidence is published.
 */
export function loadConfig(): AppConfig {
  const dataDir = resolve(process.cwd(), optional('QDSR_DATA_DIR') ?? '.data');

  return {
    port: numeric('PORT', 8080),
    dataDir,
    databaseUrl: optional('DATABASE_URL'),
    storage: {
      indexerRpc: optional('OG_STORAGE_INDEXER_RPC'),
      evmRpc: optional('OG_STORAGE_EVM_RPC') ?? optional('OG_RPC_URL'),
      privateKey: optional('OG_STORAGE_PRIVATE_KEY') ?? optional('OG_PRIVATE_KEY'),
      cacheDir: resolve(dataDir, 'storage'),
    },
    chain: {
      rpcUrl: optional('OG_RPC_URL'),
      chainId: numeric('OG_CHAIN_ID', 16661),
      privateKey: optional('OG_PRIVATE_KEY'),
      registryAddress: optional('QDSR_REGISTRY_ADDRESS'),
      agenticIdAddress: optional('AGENTIC_ID_ADDRESS'),
    },
    defaults: {
      bootstrapIterations: numeric('QDSR_BOOTSTRAP_ITERATIONS', 10_000),
      cscvSplits: numeric('QDSR_CSCV_SPLITS', 16),
      seed: numeric('QDSR_DEFAULT_SEED', 20260820),
    },
  };
}
