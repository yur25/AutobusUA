import { Injectable } from "@nestjs/common";
import { InMemoryDatabase } from "./in-memory-database.js";
import type { IdempotencyStore } from "./idempotency.js";

@Injectable()
export class InMemoryIdempotencyStore implements IdempotencyStore {
    constructor(private readonly database: InMemoryDatabase) {}

    executeIdempotently<T>(
        userId: string,
        operation: string,
        key: string,
        requestHash: string,
        action: () => Promise<{ value: T; statusCode: number }>,
    ): Promise<{ value: T; statusCode: number; replayed: boolean }> {
        return this.database.executeIdempotently(userId, operation, key, requestHash, action);
    }
}
