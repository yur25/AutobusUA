import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const testEnvironmentPath = resolve(process.cwd(), ".env.test");
if (existsSync(testEnvironmentPath)) {
    process.loadEnvFile(testEnvironmentPath);
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
    throw new Error("Set TEST_DATABASE_URL in .env.test before running test migrations");
}

const databaseUrl = new URL(testDatabaseUrl);
if (decodeURIComponent(databaseUrl.pathname.slice(1)) !== "autobusua_test") {
    throw new Error("Test migrations are restricted to the dedicated autobusua_test database");
}

process.env.DATABASE_URL = testDatabaseUrl;
await import("../dist/migrate.js");
