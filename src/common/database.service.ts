import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { StructuredLogger } from "./structured-logger.js";

export interface SqlResult<Row extends QueryResultRow = QueryResultRow> {
    rows: Row[];
    rowCount: number;
}

export interface SqlExecutor {
    query<Row extends QueryResultRow = QueryResultRow>(
        operation: string,
        text: string,
        values?: unknown[],
    ): Promise<SqlResult<Row>>;
}

interface PgFailure {
    code?: unknown;
}

const STARTUP_ATTEMPTS = 3;
const MAX_TRANSACTION_RETRIES = 3;
const RETRY_DELAYS_MS = [25, 50, 100];

function retryDelay(index: number): number {
    return RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 100;
}

export function postgresErrorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return undefined;
    }
    const code = (error as PgFailure).code;
    return typeof code === "string" ? code : undefined;
}

export function isDatabaseUnavailable(error: unknown): boolean {
    const code = postgresErrorCode(error);
    return Boolean(
        code &&
        (code.startsWith("08") ||
            [
                "53300",
                "57P01",
                "57P02",
                "57P03",
                "57P04",
                "ECONNREFUSED",
                "ECONNRESET",
                "ETIMEDOUT",
                "EHOSTUNREACH",
                "ENETUNREACH",
                "ENOTFOUND",
            ].includes(code)),
    );
}

function isRetryableTransactionError(error: unknown): boolean {
    const code = postgresErrorCode(error);
    return code === "40001" || code === "40P01";
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
    private pool: Pool | undefined;

    constructor(private readonly logger: StructuredLogger) {}

    async onModuleInit(): Promise<void> {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL must be configured before application startup");
        }

        const pool = new Pool({
            connectionString,
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            application_name: "autobusua-api",
        });
        this.pool = pool;
        pool.on("error", (error: Error) => {
            this.logger.error("database.pool.idle_client_error", error.stack);
        });

        let lastError: unknown;
        for (let attempt = 1; attempt <= STARTUP_ATTEMPTS; attempt += 1) {
            try {
                await pool.query("SELECT now()");
                this.logger.log("database.startup.connection_verified", { attempt });
                await this.applyMigrations();
                return;
            } catch (error) {
                lastError = error;
                this.logger.error("database.startup.attempt_failed", undefined, {
                    attempt,
                    errorCode: postgresErrorCode(error) ?? null,
                });
                if (!isDatabaseUnavailable(error) || attempt === STARTUP_ATTEMPTS) {
                    await this.closePool();
                    throw error;
                }
                await sleep(retryDelay(attempt - 1) + Math.floor(Math.random() * 25));
            }
        }

        await this.closePool();
        throw new Error(
            `PostgreSQL startup failed after ${STARTUP_ATTEMPTS} attempts: ${String(lastError)}`,
        );
    }

    async onApplicationShutdown(): Promise<void> {
        await this.closePool();
    }

    async query<Row extends QueryResultRow = QueryResultRow>(
        operation: string,
        text: string,
        values: unknown[] = [],
    ): Promise<SqlResult<Row>> {
        const pool = this.requirePool();
        const startedAt = Date.now();
        try {
            const result = await pool.query<Row>(text, values);
            const rowCount = result.rowCount ?? result.rows.length;
            this.logger.debug("database.query.completed", {
                operation,
                rowCount,
                durationMs: Date.now() - startedAt,
            });
            return { rows: result.rows, rowCount };
        } catch (error) {
            this.logger.error("database.query.failed", undefined, {
                operation,
                errorCode: postgresErrorCode(error) ?? null,
                durationMs: Date.now() - startedAt,
            });
            if (isDatabaseUnavailable(error)) {
                throw new ServiceUnavailableException("Database temporarily unavailable");
            }
            throw error;
        }
    }

    async checkReadiness(): Promise<void> {
        await this.query("health.readiness", "SELECT now()");
    }

    async withTransaction<T>(
        operation: string,
        work: (executor: SqlExecutor) => Promise<T>,
        retrySerializationFailures = false,
        readOnlySnapshot = false,
    ): Promise<T> {
        for (let attempt = 1; ; attempt += 1) {
            const client = await this.connect(operation);
            let transactionStarted = false;
            let retryDelayIndex: number | undefined;
            try {
                await client.query(
                    readOnlySnapshot ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
                );
                transactionStarted = true;
                const result = await work(this.createClientExecutor(client, operation));
                await client.query("COMMIT");
                this.logger.debug("database.transaction.committed", {
                    operation,
                    attempt,
                });
                return result;
            } catch (error) {
                if (transactionStarted) {
                    try {
                        await client.query("ROLLBACK");
                    } catch (rollbackError) {
                        this.logger.error("database.transaction.rollback_failed", undefined, {
                            operation,
                            errorCode: postgresErrorCode(rollbackError) ?? null,
                        });
                    }
                }
                const canRetry =
                    retrySerializationFailures &&
                    isRetryableTransactionError(error) &&
                    attempt <= MAX_TRANSACTION_RETRIES;
                this.logger.error("database.transaction.failed", undefined, {
                    operation,
                    attempt,
                    errorCode: postgresErrorCode(error) ?? null,
                    retrying: canRetry,
                });
                if (!canRetry) {
                    if (isDatabaseUnavailable(error)) {
                        throw new ServiceUnavailableException("Database temporarily unavailable");
                    }
                    throw error;
                }
                retryDelayIndex = Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1);
            } finally {
                client.release();
            }
            if (retryDelayIndex !== undefined) {
                await sleep(retryDelay(retryDelayIndex) + Math.floor(Math.random() * 25));
            }
        }
    }

    withReadSnapshot<T>(
        operation: string,
        work: (executor: SqlExecutor) => Promise<T>,
    ): Promise<T> {
        return this.withTransaction(operation, work, true, true);
    }

    private async applyMigrations(): Promise<void> {
        const migrationDirectory = fileURLToPath(
            new URL("../../database/migrations/", import.meta.url),
        );
        const migrationFiles = (await readdir(migrationDirectory))
            .filter((file) => /^\d+[-_].+\.sql$/.test(file))
            .sort();
        const client = await this.connect("database.migrations");
        let lockAcquired = false;
        try {
            await client.query("SELECT pg_advisory_lock($1)", [746386507412]);
            lockAcquired = true;
            await client.query(
                `CREATE TABLE IF NOT EXISTS schema_migrations (
                    version text PRIMARY KEY,
                    applied_at timestamptz NOT NULL DEFAULT now()
                )`,
            );
            const appliedResult = await client.query<{ version: string }>(
                "SELECT version FROM schema_migrations",
            );
            const applied = new Set(appliedResult.rows.map((row) => row.version));

            for (const file of migrationFiles) {
                if (applied.has(file)) {
                    continue;
                }
                const sql = await readFile(resolve(migrationDirectory, file), "utf8");
                await client.query("BEGIN");
                try {
                    await client.query(sql);
                    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
                        file,
                    ]);
                    await client.query("COMMIT");
                    this.logger.log("database.migration.applied", { migration: file });
                } catch (error) {
                    try {
                        await client.query("ROLLBACK");
                    } catch (rollbackError) {
                        this.logger.error("database.migration.rollback_failed", undefined, {
                            migration: file,
                            errorCode: postgresErrorCode(rollbackError) ?? null,
                        });
                    }
                    throw error;
                }
            }
        } finally {
            if (lockAcquired) {
                try {
                    await client.query("SELECT pg_advisory_unlock($1)", [746386507412]);
                } catch (error) {
                    this.logger.error("database.migration.unlock_failed", undefined, {
                        errorCode: postgresErrorCode(error) ?? null,
                    });
                }
            }
            client.release();
        }
    }

    private async connect(operation: string): Promise<PoolClient> {
        try {
            return await this.requirePool().connect();
        } catch (error) {
            this.logger.error("database.connection.failed", undefined, {
                operation,
                errorCode: postgresErrorCode(error) ?? null,
            });
            throw error;
        }
    }

    private createClientExecutor(client: PoolClient, transaction: string): SqlExecutor {
        return {
            query: async <Row extends QueryResultRow = QueryResultRow>(
                operation: string,
                text: string,
                values: unknown[] = [],
            ): Promise<SqlResult<Row>> => {
                const startedAt = Date.now();
                try {
                    const result = await client.query<Row>(text, values);
                    const rowCount = result.rowCount ?? result.rows.length;
                    this.logger.debug("database.query.completed", {
                        operation: `${transaction}.${operation}`,
                        rowCount,
                        durationMs: Date.now() - startedAt,
                    });
                    return { rows: result.rows, rowCount };
                } catch (error) {
                    this.logger.error("database.query.failed", undefined, {
                        operation: `${transaction}.${operation}`,
                        errorCode: postgresErrorCode(error) ?? null,
                        durationMs: Date.now() - startedAt,
                    });
                    if (isDatabaseUnavailable(error)) {
                        throw new ServiceUnavailableException("Database temporarily unavailable");
                    }
                    throw error;
                }
            },
        };
    }

    private requirePool(): Pool {
        if (!this.pool) {
            throw new Error("Database pool has not been initialized");
        }
        return this.pool;
    }

    private async closePool(): Promise<void> {
        if (this.pool) {
            const pool = this.pool;
            this.pool = undefined;
            await pool.end();
            this.logger.log("database.pool.closed");
        }
    }
}
