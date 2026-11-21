import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { request } from "node:http";
import { afterEach, it } from "vitest";

if (existsSync(".env.test")) {
    process.loadEnvFile(".env.test");
}

const port = 3100;
const servers: ChildProcess[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(stopServer));
});

interface HealthResponse {
    statusCode: number | undefined;
    body: string;
}

function requestEndpoint(path: string, method = "GET", body?: string): Promise<HealthResponse> {
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

async function waitForHealth(server: ChildProcess): Promise<HealthResponse> {
    const deadline = Date.now() + 30000;
    let lastError: unknown;

    while (Date.now() < deadline) {
        if (server.exitCode !== null) {
            throw new Error(`Application exited with code ${server.exitCode}`);
        }

        try {
            return await requestEndpoint("/health");
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }

    throw new Error(`Health endpoint did not become available: ${String(lastError)}`);
}

async function stopServer(server: ChildProcess): Promise<void> {
    if (server.exitCode === null && server.signalCode === null) {
        const exited = once(server, "exit");
        server.kill();
        await exited;
    }
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
            PORT: String(port),
        },
        stdio: "ignore",
    });

    servers.push(server);

    const response = await waitForHealth(server);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, '{"status":"ok"}');

    const versionResponse = await requestEndpoint("/version");
    const readinessResponse = await requestEndpoint("/health/ready");
    const tripsResponse = await requestEndpoint("/api/v1/trips");
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
});

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
                PORT: String(port),
            },
            stdio: "ignore",
        },
    );
    servers.push(server);

    const response = await waitForHealth(server);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, '{"status":"ok"}');
    const readiness = await requestEndpoint("/health/ready");
    assert.equal(readiness.statusCode, 200);
    const invalidRegistration = await requestEndpoint("/api/v1/auth/register", "POST", "{}");
    assert.equal(invalidRegistration.statusCode, 400);
});
