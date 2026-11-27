import { describe, expect, it, vi } from "vitest";
import { DatabaseService } from "./database.service.js";
import { PostgresIdempotencyStore } from "./postgres-idempotency.store.js";
import { createLogger } from "../../tests/test-helpers.js";

describe("PostgresIdempotencyStore cleanup failure", () => {
    it("runs cleanup immediately and repeats it until shutdown by default", async () => {
        vi.useFakeTimers();
        const originalSchedulerEnabled = process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
        try {
            delete process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
            const logger = createLogger();
            const database = new DatabaseService(logger);
            const query = vi.spyOn(database, "query").mockResolvedValue({ rows: [], rowCount: 0 });
            const store = new PostgresIdempotencyStore(database, logger);

            store.onApplicationBootstrap();
            await vi.advanceTimersByTimeAsync(0);
            expect(query).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(59_999);
            expect(query).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(query).toHaveBeenCalledTimes(2);
            await store.beforeApplicationShutdown();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(query).toHaveBeenCalledTimes(2);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            if (originalSchedulerEnabled === undefined) {
                delete process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
            } else {
                process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED = originalSchedulerEnabled;
            }
            vi.useRealTimers();
        }
    });

    it("logs cleanup failures and stops its timer during shutdown", async () => {
        vi.useFakeTimers();
        const originalSchedulerEnabled = process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
        try {
            delete process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
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
            if (originalSchedulerEnabled === undefined) {
                delete process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
            } else {
                process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED = originalSchedulerEnabled;
            }
            vi.useRealTimers();
        }
    });

    it("does not schedule automatic cleanup when disabled", async () => {
        vi.useFakeTimers();
        const originalSchedulerEnabled = process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
        try {
            process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED = "false";
            const logger = createLogger();
            const database = new DatabaseService(logger);
            const query = vi.spyOn(database, "query");
            const store = new PostgresIdempotencyStore(database, logger);

            store.onApplicationBootstrap();
            await vi.advanceTimersByTimeAsync(0);

            expect(query).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
            await store.beforeApplicationShutdown();
        } finally {
            if (originalSchedulerEnabled === undefined) {
                delete process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
            } else {
                process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED = originalSchedulerEnabled;
            }
            vi.useRealTimers();
        }
    });

    it("rejects an invalid scheduler setting", () => {
        const originalSchedulerEnabled = process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
        try {
            process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED = "invalid";
            const logger = createLogger();
            const store = new PostgresIdempotencyStore(new DatabaseService(logger), logger);
            expect(() => store.onApplicationBootstrap()).toThrow(
                "IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED must be true or false",
            );
        } finally {
            if (originalSchedulerEnabled === undefined) {
                delete process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED;
            } else {
                process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED = originalSchedulerEnabled;
            }
        }
    });
});
