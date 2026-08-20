import { MemoryStore } from './memory.js';
import { PostgresStore } from './postgres.js';
import type { Store } from './types.js';

export { MemoryStore } from './memory.js';
export { PostgresStore } from './postgres.js';
export type * from './types.js';

export interface StoreHandle {
  store: Store;
  kind: 'postgres' | 'memory';
}

/**
 * Selects a persistence backend.
 *
 * Postgres when DATABASE_URL is present, otherwise the on-disk JSON store. The
 * decision is logged at startup because "where did my data go" is otherwise a
 * genuinely confusing question to answer later.
 */
export async function createStore(options: {
  databaseUrl?: string;
  dataDir: string;
}): Promise<StoreHandle> {
  if (options.databaseUrl) {
    return { store: new PostgresStore(options.databaseUrl), kind: 'postgres' };
  }
  const store = new MemoryStore(options.dataDir);
  await store.load();
  return { store, kind: 'memory' };
}
