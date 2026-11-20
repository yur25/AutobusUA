import { ConflictException, Injectable } from "@nestjs/common";
import type {
    CarrierApplication,
    IdempotencyRecord,
    Session,
    Ticket,
    Trip,
    User,
} from "./domain.js";
import { StructuredLogger } from "./structured-logger.js";

@Injectable()
export class InMemoryDatabase {
    readonly users = new Map<string, User>();
    readonly usersByPhone = new Map<string, string>();
    readonly applications = new Map<string, CarrierApplication>();
    readonly trips = new Map<string, Trip>();
    readonly tickets = new Map<string, Ticket>();
    readonly sessions = new Map<string, Session>();
    readonly idempotency = new Map<string, IdempotencyRecord>();

    private readonly locks = new Map<string, Promise<void>>();

    constructor(private readonly logger: StructuredLogger) {}

    async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.locks.set(key, current);
        await previous;

        try {
            return await operation();
        } finally {
            release();
            if (this.locks.get(key) === current) {
                this.locks.delete(key);
            }
        }
    }

    async executeIdempotently<T>(
        userId: string,
        operation: string,
        key: string,
        requestHash: string,
        action: () => Promise<{ value: T; statusCode: number }>,
    ): Promise<{ value: T; statusCode: number; replayed: boolean }> {
        const lockKey = JSON.stringify([userId, operation, key]);
        return this.withLock(lockKey, async () => {
            const existing = this.idempotency.get(lockKey);
            if (existing && existing.expiresAt > Date.now()) {
                if (existing.requestHash !== requestHash) {
                    this.logger.warn("repository.idempotency.payload_mismatch", {
                        operation,
                    });
                    throw new ConflictException(
                        "Idempotency-Key was already used with a different request payload",
                    );
                }
                this.logger.log("repository.idempotency.replayed", { operation });
                return {
                    value: structuredClone(existing.response) as T,
                    statusCode: existing.statusCode,
                    replayed: true,
                };
            }

            const result = await action();
            this.idempotency.set(lockKey, {
                userId,
                operation,
                requestHash,
                response: structuredClone(result.value),
                statusCode: result.statusCode,
                expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            });
            this.logger.log("repository.idempotency.recorded", {
                operation,
                statusCode: result.statusCode,
            });
            return { ...result, replayed: false };
        });
    }
}
