import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * Opens a connection pool.
 *
 * Exported as a factory rather than a module-level singleton so that importing
 * this package does not require a database to exist. The API server runs against
 * an on-disk store when DATABASE_URL is absent, and a throw at import time would
 * make that impossible.
 */
export function createDb(connectionString: string): DatabaseHandle {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

export { schema };
export * from "./schema";
