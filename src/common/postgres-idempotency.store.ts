import { ConflictException, Injectable } from "@nestjs/common";
import type { BeforeApplicationShutdown, OnApplicationBootstrap } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { DatabaseService, type SqlExecutor } from "./database.service.js";
import type { IdempotencyStore } from "./idempotency.js";
import { StructuredLogger } from "./structured-logger.js";

interface IdempotencyRow extends QueryResultRow {
    request_hash: string;
    status: "IN_PROGRESS" | "COMPLETED";
    response_status: number | null;
    response_body: unknown;
}

@Injectable()
export class PostgresIdempotencyStore
    implements IdempotencyStore, OnApplicationBootstrap, BeforeApplicationShutdown
{
    private cleanupTimer: NodeJS.Timeout | undefined;
    private cleanupTask: Promise<void> | undefined;
    private stopping = false;

    constructor(
        private readonly database: DatabaseService,
        private readonly logger: StructuredLogger,
    ) {}

    onApplicationBootstrap(): void {
        this.scheduleCleanup(0);
    }

    async beforeApplicationShutdown(): Promise<void> {
        this.stopping = true;
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
        }
        await this.cleanupTask;
    }

    private scheduleCleanup(delayMs: number): void {
        this.cleanupTimer = setTimeout(() => {
            this.cleanupTask = this.cleanupExpiredRecords();
        }, delayMs);
        this.cleanupTimer.unref();
    }

    private async cleanupExpiredRecords(): Promise<void> {
        try {
            const result = await this.database.query(
                "idempotency.cleanup_expired",
                `DELETE FROM idempotency_record
                 WHERE id IN (
                     SELECT id FROM idempotency_record
                     WHERE status = 'COMPLETED' AND expires_at <= now()
                     ORDER BY expires_at, id
                     LIMIT 1000
                     FOR UPDATE SKIP LOCKED
                 )`,
            );
            this.logger.log("idempotency.cleanup.completed", { deleted: result.rowCount });
        } catch (error) {
            this.logger.error("idempotency.cleanup.failed", undefined, {
                errorCode: error instanceof Error ? error.name : "UnknownError",
            });
        } finally {
            if (!this.stopping) {
                this.scheduleCleanup(60_000);
            }
        }
    }

    executeIdempotently<T>(
        userId: string,
        operation: string,
        keyHash: string,
        requestHash: string,
        action: (executor: SqlExecutor) => Promise<{ value: T; statusCode: number }>,
    ): Promise<{ value: T; statusCode: number; replayed: boolean }> {
        return this.database.withTransaction(
            `idempotency.${operation}`,
            async (executor) => {
                await executor.query(
                    "idempotency.delete_expired_key",
                    `DELETE FROM idempotency_record
                     WHERE user_id = $1 AND operation = $2 AND key_hash = $3
                       AND expires_at <= now()`,
                    [userId, operation, keyHash],
                );

                // Lock an existing key until replay completes, so cleanup cannot remove it.
                const inserted = await executor.query<{ id: string }>(
                    "idempotency.reserve_key",
                    `INSERT INTO idempotency_record
                        (id, user_id, operation, key_hash, request_hash, status, expires_at)
                     VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', now() + interval '24 hours')
                     ON CONFLICT (user_id, operation, key_hash) DO UPDATE
                     SET key_hash = idempotency_record.key_hash WHERE false
                     RETURNING id`,
                    [randomUUID(), userId, operation, keyHash, requestHash],
                );

                if (inserted.rowCount === 0) {
                    const existing = await executor.query<IdempotencyRow>(
                        "idempotency.find_existing",
                        `SELECT request_hash, status, response_status, response_body
                         FROM idempotency_record
                         WHERE user_id = $1 AND operation = $2 AND key_hash = $3
                         FOR UPDATE`,
                        [userId, operation, keyHash],
                    );
                    const record = existing.rows[0];
                    if (!record) {
                        throw new Error("Idempotency record disappeared during lookup");
                    }
                    if (record.request_hash !== requestHash) {
                        this.logger.warn("idempotency.payload_mismatch", { operation });
                        throw new ConflictException(
                            "Idempotency-Key was already used with a different request payload",
                        );
                    }
                    if (record.status !== "COMPLETED" || record.response_status === null) {
                        throw new ConflictException(
                            "An operation with this Idempotency-Key is still in progress",
                        );
                    }

                    this.logger.log("idempotency.replayed", { operation });
                    return {
                        value: record.response_body as T,
                        statusCode: record.response_status,
                        replayed: true,
                    };
                }

                const result = await action(executor);
                const recordId = inserted.rows[0]?.id;
                if (!recordId) {
                    throw new Error("Idempotency key reservation returned no record id");
                }
                await executor.query(
                    "idempotency.complete",
                    `UPDATE idempotency_record
                     SET status = 'COMPLETED',
                         response_status = $2,
                         response_body = $3::jsonb,
                         completed_at = now()
                     WHERE id = $1`,
                    [recordId, result.statusCode, JSON.stringify(result.value)],
                );
                this.logger.log("idempotency.completed", {
                    operation,
                    statusCode: result.statusCode,
                });
                return { ...result, replayed: false };
            },
            true,
        );
    }
}
