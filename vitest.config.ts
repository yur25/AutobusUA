import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.spec.ts", "tests/**/*.test.ts"],
        setupFiles: ["./tests/setup.ts"],
        fileParallelism: false,
        maxWorkers: 1,
        clearMocks: true,
        restoreMocks: true,
        coverage: {
            provider: "v8",
            include: [
                "src/common/database.service.ts",
                "src/common/idempotency.ts",
                "src/common/postgres-idempotency.store.ts",
                "src/modules/auth/auth.repository.ts",
                "src/modules/auth/auth.service.ts",
                "src/modules/auth/roles.guard.ts",
                "src/modules/auth/session-auth.guard.ts",
                "src/modules/bookings/bookings.repository.ts",
                "src/modules/bookings/bookings.service.ts",
                "src/modules/carriers/carriers.repository.ts",
                "src/modules/carriers/carriers.service.ts",
                "src/modules/trips/trips.repository.ts",
                "src/modules/trips/trips.service.ts",
            ],
            reporter: ["text"],
        },
    },
});
