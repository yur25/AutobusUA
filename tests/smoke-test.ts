import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import test from "node:test";

const port = 3100;

interface HealthResponse {
    statusCode: number | undefined;
    body: string;
}

function requestEndpoint(path: string): Promise<HealthResponse> {
    return new Promise((resolve, reject) => {
        const healthRequest = request(
            {
                hostname: "127.0.0.1",
                port,
                path,
                method: "GET",
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

test("application health and version endpoints respond successfully", async (t) => {
    const server = spawn(process.execPath, ["dist/main.js"], {
        env: { ...process.env, PORT: String(port) },
        stdio: "ignore",
    });

    t.after(() => {
        server.kill();
    });

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
        storage: "in-memory",
    });
    assert.equal(tripsResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(tripsResponse.body), {
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
    });
});
