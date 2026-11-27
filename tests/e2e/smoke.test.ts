import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { request } from "node:http";
import { afterEach, it } from "vitest";
import { stopServer, waitForServerPort } from "./server.js";

if (existsSync(".env.test")) {
    process.loadEnvFile(".env.test");
}

const servers: ChildProcess[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(stopServer));
});

interface HealthResponse {
    statusCode: number | undefined;
    body: string;
}

function requestEndpoint(
    port: number,
    path: string,
    method = "GET",
    body?: string,
): Promise<HealthResponse> {
    return new Promise((resolve, reject) => {
        const healthRequest = request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers: body === undefined ? undefined : { "content-type": "application/json" },
            },
            (response) => {
                let body = "";

                response.setEncoding("utf8");
                response.on("data", (chunk: string) => {
                    body += chunk;
                });
                response.on("end", () => {
                    resolve({ statusCode: response.statusCode, body });
                });
            },
        );

        healthRequest.on("error", reject);
        if (body !== undefined) {
            healthRequest.write(body);
        }
        healthRequest.end();
    });
}

function getTestDatabaseUrl(): string {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    assert.ok(testDatabaseUrl, "Set TEST_DATABASE_URL in .env.test to a dedicated test database");
    const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
    assert.equal(
        databaseName,
        "autobusua_test",
        "Smoke tests must use the dedicated autobusua_test database",
    );
    return testDatabaseUrl;
}

it("application health and version endpoints respond successfully", async () => {
    const testDatabaseUrl = getTestDatabaseUrl();

    const server = spawn(process.execPath, ["dist/main.js"], {
        env: {
            ...process.env,
            DATABASE_URL: testDatabaseUrl,
            IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED: "false",
            PORT: "0",
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
    });

    servers.push(server);

    const port = await waitForServerPort(server);
    const response = await requestEndpoint(port, "/health");

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, '{"status":"ok"}');

    const versionResponse = await requestEndpoint(port, "/version");
    const readinessResponse = await requestEndpoint(port, "/health/ready");
    const tripsResponse = await requestEndpoint(port, "/api/v1/trips");
    const expectedCommit =
        process.env.GIT_COMMIT?.trim() ??
        execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    assert.equal(versionResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(versionResponse.body), { commit: expectedCommit });
    assert.equal(readinessResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(readinessResponse.body), {
        status: "ok",
        storage: "postgresql",
    });
    assert.equal(tripsResponse.statusCode, 200);
    const trips = JSON.parse(tripsResponse.body) as {
        items: unknown[];
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
    };
    assert.ok(Array.isArray(trips.items));
    assert.equal(trips.page, 1);
    assert.equal(trips.pageSize, 20);
    assert.ok(trips.totalItems >= trips.items.length);
    assert.equal(trips.totalPages, Math.ceil(trips.totalItems / trips.pageSize));
}, 40_000);

it("development entry point starts and validates requests", async () => {
    const testDatabaseUrl = getTestDatabaseUrl();

    const server = spawn(
        process.execPath,
        [
            "--enable-source-maps",
            "--import",
            "@swc-node/register/esm-register",
            "scripts/start-dev.mjs",
        ],
        {
            env: {
                ...process.env,
                DATABASE_URL: testDatabaseUrl,
                IDEMPOTENCY_CLEANUP_SCHEDULER_ENABLED: "false",
                PORT: "0",
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
    );
    servers.push(server);

    const port = await waitForServerPort(server);
    const response = await requestEndpoint(port, "/health");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, '{"status":"ok"}');
    const readiness = await requestEndpoint(port, "/health/ready");
    assert.equal(readiness.statusCode, 200);
    const invalidRegistration = await requestEndpoint(port, "/api/v1/auth/register", "POST", "{}");
    assert.equal(invalidRegistration.statusCode, 400);
}, 40_000);
