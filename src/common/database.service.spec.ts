import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DatabaseService, isDatabaseUnavailable } from "./database.service.js";
import { createLogger } from "../../tests/test-helpers.js";

function databaseWithPool(pool: object): DatabaseService {
    const database = new DatabaseService(createLogger());
    Object.defineProperty(database, "pool", { configurable: true, value: pool });
    return database;
}

describe("DatabaseService failure handling", () => {
    it.each([
        ["connection class errors", "08006", true],
        ["connection refusal", "ECONNREFUSED", true],
        ["too many connections", "53300", true],
        ["serialization failures", "40001", false],
        ["unique constraint violations", "23505", false],
        ["errors without a PostgreSQL code", undefined, false],
    ])("classifies %s correctly", (_label, code, unavailable) => {
        expect(isDatabaseUnavailable(code === undefined ? new Error() : { code })).toBe(
            unavailable,
        );
    });

    it("maps unavailable query failures to 503 and preserves other database errors", async () => {
        const unavailable = Object.assign(new Error("connection refused"), {
            code: "ECONNREFUSED",
        });
        const unavailablePool = {
            query: vi.fn(async () => {
                throw unavailable;
            }),
        };
        await expect(
            databaseWithPool(unavailablePool).query("test.unavailable", "SELECT 1"),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);

        const constraint = Object.assign(new Error("duplicate"), { code: "23505" });
        const constraintPool = {
            query: vi.fn(async () => {
                throw constraint;
            }),
        };
        await expect(
            databaseWithPool(constraintPool).query("test.constraint", "INSERT"),
        ).rejects.toBe(constraint);
    });

    it("rolls back and releases the client when transaction work fails", async () => {
        const originalError = new Error("business operation failed");
        const statements: string[] = [];
        const client = {
            query: vi.fn(async (text: string) => {
                statements.push(text);
                return { rows: [], rowCount: 0 };
            }),
            release: vi.fn(),
        };
        const pool = { connect: vi.fn(async () => client) };
        const database = databaseWithPool(pool);

        await expect(
            database.withTransaction("test.rollback", async () => {
                throw originalError;
            }),
        ).rejects.toBe(originalError);

        expect(statements).toEqual(["BEGIN", "ROLLBACK"]);
        expect(client.release).toHaveBeenCalledOnce();
    });

    it("retries a serialization failure only when explicitly enabled", async () => {
        let connectionCount = 0;
        const clients = Array.from({ length: 2 }, () => ({
            query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
            release: vi.fn(),
        }));
        const pool = {
            connect: vi.fn(async () => {
                const client = clients[connectionCount];
                connectionCount += 1;
                if (!client) {
                    throw new Error("unexpected extra connection");
                }
                return client;
            }),
        };
        const database = databaseWithPool(pool);
        const serializationFailure = Object.assign(new Error("serialization failure"), {
            code: "40001",
        });
        let workCount = 0;

        await expect(
            database.withTransaction(
                "test.retry",
                async () => {
                    workCount += 1;
                    if (workCount === 1) {
                        throw serializationFailure;
                    }
                    return "committed";
                },
                true,
            ),
        ).resolves.toBe("committed");

        expect(workCount).toBe(2);
        expect(pool.connect).toHaveBeenCalledTimes(2);
        expect(clients[0]?.release).toHaveBeenCalledOnce();
        expect(clients[1]?.release).toHaveBeenCalledOnce();

        const noRetryClient = {
            query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
            release: vi.fn(),
        };
        const noRetryDatabase = databaseWithPool({
            connect: vi.fn(async () => noRetryClient),
        });
        await expect(
            noRetryDatabase.withTransaction("test.no_retry", async () => {
                throw serializationFailure;
            }),
        ).rejects.toBe(serializationFailure);
        expect(noRetryClient.release).toHaveBeenCalledOnce();
    });
});
