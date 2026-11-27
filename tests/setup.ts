import { existsSync } from "node:fs";
import { resolve } from "node:path";

const testEnvironmentPath = resolve(process.cwd(), ".env.test");
if (existsSync(testEnvironmentPath)) {
    process.loadEnvFile(testEnvironmentPath);
}

process.env.IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED = "false";
