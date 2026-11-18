import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import test from "node:test";

const port = 3100;

interface HealthResponse {
    statusCode: number | undefined;
    body: string;
}

function requestHealth(): Promise<HealthResponse> {
    return new Promise((resolve, reject) => {
        const healthRequest = request(
            {
                hostname: "127.0.0.1",
                port,
                path: "/health",
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
    const deadline = Date.now() + 10000;
    let lastError: unknown;

    while (Date.now() < deadline) {
        if (server.exitCode !== null) {
            throw new Error(`Application exited with code ${server.exitCode}`);
        }

        try {
            return await requestHealth();
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }

    throw new Error(`Health endpoint did not become available: ${String(lastError)}`);
}

test("application health endpoint responds successfully", async (t) => {
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
});
