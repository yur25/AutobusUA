import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

export const IDEMPOTENCY_STORE = Symbol("IDEMPOTENCY_STORE");

export interface IdempotencyStore {
    executeIdempotently<T>(
        userId: string,
        operation: string,
        key: string,
        requestHash: string,
        action: () => Promise<{ value: T; statusCode: number }>,
    ): Promise<{ value: T; statusCode: number; replayed: boolean }>;
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(stableValue);
    }
    if (typeof value !== "object" || value === null) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, stableValue(item)]),
    );
}

function requestHash(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(stableValue(value)))
        .digest("hex");
}

export async function executeIdempotently<T>(
    store: IdempotencyStore,
    userId: string,
    operation: string,
    key: string | undefined,
    request: unknown,
    action: () => Promise<{ value: T; statusCode: number }>,
): Promise<{ value: T; statusCode: number; replayed: boolean }> {
    if (!key || key.length < 8 || key.length > 200) {
        throw new BadRequestException("A valid Idempotency-Key header is required");
    }

    return store.executeIdempotently(userId, operation, key, requestHash(request), action);
}
