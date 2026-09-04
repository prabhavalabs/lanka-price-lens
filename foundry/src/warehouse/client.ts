import pg from "pg";

/**
 * The small database surface the warehouse code needs, implemented for a real
 * PostgreSQL server (node-postgres) and for the embedded PGlite engine used in
 * tests, so every query path is exercised without a server.
 */
export type WarehouseClient = {
  readonly kind: "postgres" | "pglite";
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Runs `work` inside one transaction; the client handed to it must be used for every statement. */
  transaction: <T>(work: (tx: WarehouseClient) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };

/** A client bound to one connection that is already inside a transaction; nested transactions reuse it. */
function transactionalClient(kind: WarehouseClient["kind"], runner: Runner): WarehouseClient {
  const client: WarehouseClient = {
    kind,
    query: async <T,>(sql: string, params: unknown[] = []) => (await runner.query(sql, params)).rows as T[],
    transaction: (work) => work(client),
    close: async () => undefined,
  };
  return client;
}

const { Pool } = pg;

export async function connectWarehouse(connectionString: string, options: { max?: number; statementTimeoutMs?: number } = {}): Promise<WarehouseClient> {
  const pool = new Pool({
    connectionString,
    max: options.max ?? 4,
    statement_timeout: options.statementTimeoutMs ?? 120_000,
    application_name: "lanka-price-lens-warehouse",
  });
  // Fail fast with a clear error when the server is unreachable or credentials are wrong.
  const probe = await pool.connect();
  probe.release();
  return {
    kind: "postgres",
    query: async <T,>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
    async transaction(work) {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const result = await work(transactionalClient("postgres", connection));
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}

/** In-process PostgreSQL (PGlite) for tests and local experiments; nothing to install or start. */
export async function embeddedWarehouse(dataDirectory?: string): Promise<WarehouseClient> {
  const { PGlite } = await import("@electric-sql/pglite");
  const engine = dataDirectory ? new PGlite(dataDirectory) : new PGlite();
  await engine.waitReady;
  return {
    kind: "pglite",
    query: async <T,>(sql: string, params: unknown[] = []) => (await engine.query(sql, params)).rows as T[],
    transaction: async <T,>(work: (tx: WarehouseClient) => Promise<T>) => engine.transaction((tx) => work(transactionalClient("pglite", tx))) as Promise<T>,
    close: () => engine.close(),
  };
}

/** Builds `($1,$2,…),($n,…)` placeholders for a multi-row insert. */
export function valuesPlaceholders(rows: number, columns: number, offset = 0): string {
  const groups: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const cells: string[] = [];
    for (let column = 0; column < columns; column += 1) cells.push(`$${offset + row * columns + column + 1}`);
    groups.push(`(${cells.join(",")})`);
  }
  return groups.join(",");
}
