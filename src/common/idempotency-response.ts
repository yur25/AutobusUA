import type { Response } from "express";

export interface IdempotentResult<T> {
    value: T;
    statusCode: number;
    replayed: boolean;
}

export function idempotentResponse<T>(response: Response, result: IdempotentResult<T>): T {
    response.status(result.statusCode);
    return result.value;
}
