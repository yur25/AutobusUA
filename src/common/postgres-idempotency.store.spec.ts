import { describe, expect, it, vi } from "vitest";
import { DatabaseService } from "./database.service.js";
import { PostgresIdempotencyStore } from "./postgres-idempotency.store.js";
import { createLogger } from "../../tests/test-helpers.js";

describe("PostgresIdempotencyStore cleanup failure", () => {
    it("logs cleanup failures and stops its timer during shutdown", async () => {
        vi.useFakeTimers();
        try {
            const logger = createLogger();
            const errorLog = vi.spyOn(logger, "error");
            const database = new DatabaseService(logger);
            const query = vi
                .spyOn(database, "query")
                .mockRejectedValue(new Error("database cleanup unavailable"));
            const store = new PostgresIdempotencyStore(database, logger);

            store.onApplicationBootstrap();
            await vi.advanceTimersByTimeAsync(0);
            await store.beforeApplicationShutdown();

            expect(query).toHaveBeenCalledOnce();
            expect(errorLog).toHaveBeenCalledWith(
                "idempotency.cleanup.failed",
                undefined,
                expect.objectContaining({ errorCode: "Error" }),
            );
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
