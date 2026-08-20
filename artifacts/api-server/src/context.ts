import { createChainClient, deriveAgentId, type ChainClient } from '@workspace/og-chain';
import { createEvidenceStorage, type EvidenceStorage } from '@workspace/og-storage';
import { ENGINE_VERSION } from '@workspace/qdsr-core';

import { loadConfig, type AppConfig } from './config.js';
import { newId } from './lib/ids.js';
import { logger } from './lib/logger.js';
import { AnchorService } from './services/anchor.js';
import { MintLookup } from './services/mint-lookup.js';
import { VerificationService } from './services/verification.js';
import { createStore, type Store } from './store/index.js';

export interface AppContext {
  config: AppConfig;
  store: Store;
  storeKind: 'postgres' | 'memory';
  storage: EvidenceStorage;
  chain: ChainClient;
  verification: VerificationService;
  anchoring: AnchorService;
  mintLookup: MintLookup;
  engineVersion: string;
  deriveAgentId: typeof deriveAgentId;
  audit(event: {
    actor: string;
    action: string;
    detail: string;
    tone: 'good' | 'bad' | 'warn' | 'cyan' | 'neutral';
  }): Promise<void>;
}

let cached: AppContext | undefined;

/**
 * Builds the application graph once.
 *
 * Everything external — the database, 0G Storage, 0G Chain — is resolved here and
 * degrades to a working local equivalent when unconfigured. The startup log states
 * which mode each dependency landed in, so nobody has to guess whether a verdict
 * they are looking at was actually published.
 */
export async function createContext(): Promise<AppContext> {
  if (cached) return cached;

  const config = loadConfig();
  const { store, kind } = await createStore({
    databaseUrl: config.databaseUrl,
    dataDir: config.dataDir,
  });
  const storage = await createEvidenceStorage(config.storage);
  const chain = createChainClient(config.chain);

  const audit: AppContext['audit'] = async (event) => {
    await store.appendAuditEvent({
      id: newId('evt'),
      createdAt: new Date().toISOString(),
      ...event,
    });
  };

  const verification = new VerificationService(store, config.defaults, audit);
  const anchoring = new AnchorService(store, storage, chain, audit);
  const mintLookup = new MintLookup(chain);

  const chainStatus = chain.status();
  logger.info(
    {
      persistence: kind,
      storage: storage.mode,
      chain: chainStatus.configured ? chainStatus.networkName : 'not configured',
      registry: chainStatus.registryAddress ?? null,
      engine: ENGINE_VERSION,
    },
    'q-dsr context ready',
  );

  cached = {
    config,
    store,
    storeKind: kind,
    storage,
    chain,
    verification,
    anchoring,
    mintLookup,
    engineVersion: ENGINE_VERSION,
    deriveAgentId,
    audit,
  };
  return cached;
}
