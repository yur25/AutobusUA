import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.spec.ts"],
        setupFiles: ["./tests/setup.ts"],
        fileParallelism: false,
        maxWorkers: 1,
        clearMocks: true,
        restoreMocks: true,
    },
});
