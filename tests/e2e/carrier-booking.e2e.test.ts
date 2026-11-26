import { randomInt, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import process from "node:process";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const port = 3101;
const baseUrl = `http://127.0.0.1:${port}`;
const createdUserIds: string[] = [];
const createdTripIds: string[] = [];
const bootstrapAdminCredentials = {
    phone: makePhone(),
    password: `E2E-admin-${randomUUID()}-Password`,
};

let server: ChildProcess | undefined;
let pool: Pool | undefined;
let testDatabaseUrl: string;

interface ApiResponse {
    status: number;
    body: unknown;
    headers: Headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    if (typeof value !== "string") {
        throw new Error(`Expected response field "${key}" to be a string`);
    }
    return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error(`Expected ${label} to be a JSON object`);
    }
    return value;
}

function getTestDatabaseUrl(): string {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
        throw new Error("Set TEST_DATABASE_URL in .env.test to a dedicated test database");
    }
    if (decodeURIComponent(new URL(url).pathname.slice(1)) !== "autobusua_test") {
        throw new Error("E2E tests are restricted to the dedicated autobusua_test database");
    }
    return url;
}

function makePhone(): string {
    return `+380${randomInt(0, 1_000_000_000).toString().padStart(9, "0")}`;
}

async function requestApi(
    path: string,
    options: {
        method?: string;
        cookie?: string;
        idempotencyKey?: string;
        body?: Record<string, unknown>;
    } = {},
): Promise<ApiResponse> {
    const headers = new Headers();
    if (options.cookie) {
        headers.set("cookie", options.cookie);
    }
    if (options.idempotencyKey) {
        headers.set("idempotency-key", options.idempotencyKey);
    }
    if (options.body) {
        headers.set("content-type", "application/json");
    }

    const requestOptions: RequestInit = {
        method: options.method ?? "GET",
        headers,
    };
    if (options.body) {
        requestOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${baseUrl}${path}`, requestOptions);
    const text = await response.text();
    let body: unknown = text;
    if (text) {
        try {
            body = JSON.parse(text) as unknown;
        } catch {
            body = text;
        }
    }
    return { status: response.status, body, headers: response.headers };
}

async function login(phone: string, password: string): Promise<{ id: string; cookie: string }> {
    const response = await requestApi("/api/v1/auth/login", {
        method: "POST",
        body: { phone, password },
    });
    expect(response.status).toBe(200);
    const body = requireRecord(response.body, "login response");
    const user = requireRecord(body.user, "login user");
    const setCookie = response.headers.get("set-cookie");
    if (!setCookie) {
        throw new Error("Login response did not set a session cookie");
    }
    return {
        id: requireString(user, "id"),
        cookie: setCookie.split(";", 1)[0] ?? setCookie,
    };
}

async function waitForHealth(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + 30_000;
    let lastError: unknown;

    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Application exited with code ${child.exitCode}`);
        }
        try {
            const response = await fetch(`${baseUrl}/health/ready`);
            if (response.ok) {
                return;
            }
            lastError = new Error(`Readiness returned HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error(`Application readiness timed out: ${String(lastError)}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
    }
}

async function cleanupCreatedRows(): Promise<void> {
    if (!pool) {
        return;
    }
    const adminResult = await pool.query<{ id: string }>(
        "SELECT id FROM app_user WHERE phone = $1",
        [bootstrapAdminCredentials.phone],
    );
    const userIds = [...createdUserIds, ...adminResult.rows.map((row) => row.id)];
    await pool.query("DELETE FROM idempotency_record WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query(
        `DELETE FROM ticket
         WHERE passenger_id = ANY($1::uuid[]) OR trip_id = ANY($2::uuid[])`,
        [userIds, createdTripIds],
    );
    await pool.query(
        `DELETE FROM carrier_application
         WHERE applicant_id = ANY($1::uuid[]) OR reviewed_by = ANY($1::uuid[])`,
        [userIds],
    );
    await pool.query("DELETE FROM trip WHERE id = ANY($1::uuid[])", [createdTripIds]);
    await pool.query("DELETE FROM app_user WHERE id = ANY($1::uuid[])", [userIds]);
}

describe("carrier application and ticket lifecycle over HTTP", () => {
    beforeAll(async () => {
        testDatabaseUrl = getTestDatabaseUrl();
        pool = new Pool({ connectionString: testDatabaseUrl });
        await pool.query("SELECT 1");

        server = spawn(process.execPath, ["scripts/start-app.mjs"], {
            env: {
                ...process.env,
                DATABASE_URL: testDatabaseUrl,
                PORT: String(port),
                BOOTSTRAP_ADMIN_PHONE: bootstrapAdminCredentials.phone,
                BOOTSTRAP_ADMIN_PASSWORD: bootstrapAdminCredentials.password,
            },
            stdio: "ignore",
        });
        await waitForHealth(server);
    }, 40_000);

    afterAll(async () => {
        try {
            if (server) {
                await stopServer(server);
            }
            await cleanupCreatedRows();
        } finally {
            await pool?.end();
        }
    });

    it("registers a passenger, promotes them to carrier, and completes a ticket lifecycle", async () => {
        const password = "E2E-strong-password-123";
        const phone = makePhone();
        const registration = await requestApi("/api/v1/auth/register", {
            method: "POST",
            body: { fullName: "E2E Passenger", phone, password },
        });
        expect(registration.status).toBe(201);
        const passenger = requireRecord(registration.body, "registration response");
        const passengerId = requireString(passenger, "id");
        createdUserIds.push(passengerId);

        const passengerSession = await login(phone, password);
        expect(passengerSession.id).toBe(passengerId);

        const departureAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        const tripPayload = {
            origin: `E2E ${randomUUID().slice(0, 8)}`,
            destination: "E2E Destination",
            departureAt,
            arrivalAt: new Date(Date.parse(departureAt) + 60 * 60 * 1000).toISOString(),
            price: "321.00",
            capacity: 1,
        };
        const forbiddenTrip = await requestApi("/api/v1/trips", {
            method: "POST",
            cookie: passengerSession.cookie,
            idempotencyKey: "e2e-forbidden-trip-0001",
            body: tripPayload,
        });
        expect(forbiddenTrip.status).toBe(403);

        const applicationKey = `e2e-application-${randomUUID()}`;
        const applicationResponse = await requestApi("/api/v1/carrier-applications", {
            method: "POST",
            cookie: passengerSession.cookie,
            idempotencyKey: applicationKey,
        });
        expect(applicationResponse.status).toBe(201);
        const application = requireRecord(applicationResponse.body, "carrier application");
        const applicationId = requireString(application, "id");

        const adminSession = await login(
            bootstrapAdminCredentials.phone,
            bootstrapAdminCredentials.password,
        );
        const reviewKey = `e2e-review-${randomUUID()}`;
        const approval = await requestApi(`/api/v1/carrier-applications/${applicationId}/approve`, {
            method: "POST",
            cookie: adminSession.cookie,
            idempotencyKey: reviewKey,
        });
        expect(approval.status).toBe(200);
        expect(approval.body).toMatchObject({ status: "VERIFIED", applicantId: passengerId });

        const tripKey = `e2e-trip-${randomUUID()}`;
        const tripResponse = await requestApi("/api/v1/trips", {
            method: "POST",
            cookie: passengerSession.cookie,
            idempotencyKey: tripKey,
            body: tripPayload,
        });
        expect(tripResponse.status).toBe(201);
        const trip = requireRecord(tripResponse.body, "created trip");
        const tripId = requireString(trip, "id");
        createdTripIds.push(tripId);
        expect(trip.carrierId).toBe(passengerId);

        const search = await requestApi(
            `/api/v1/trips?origin=${encodeURIComponent(String(tripPayload.origin))}&destination=${encodeURIComponent(tripPayload.destination)}`,
        );
        expect(search.status).toBe(200);
        const searchBody = requireRecord(search.body, "trip search");
        expect(searchBody.items).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: tripId })]),
        );

        const purchaseKey = `e2e-purchase-${randomUUID()}`;
        const purchase = await requestApi(`/api/v1/trips/${tripId}/tickets`, {
            method: "POST",
            cookie: passengerSession.cookie,
            idempotencyKey: purchaseKey,
        });
        expect(purchase.status).toBe(201);
        const ticket = requireRecord(purchase.body, "purchased ticket");
        const ticketId = requireString(ticket, "id");

        const details = await requestApi(`/api/v1/tickets/${ticketId}`, {
            cookie: passengerSession.cookie,
        });
        expect(details.status).toBe(200);
        expect(details.body).toMatchObject({ id: ticketId, status: "ACTIVE" });

        const activeTickets = await requestApi("/api/v1/tickets/me?status=ACTIVE", {
            cookie: passengerSession.cookie,
        });
        expect(activeTickets.status).toBe(200);
        expect(requireRecord(activeTickets.body, "active ticket list").items).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: ticketId })]),
        );

        const cancellationKey = `e2e-cancel-${randomUUID()}`;
        const cancellation = await requestApi(`/api/v1/tickets/${ticketId}/cancel`, {
            method: "POST",
            cookie: passengerSession.cookie,
            idempotencyKey: cancellationKey,
        });
        expect(cancellation.status).toBe(200);
        expect(cancellation.body).toMatchObject({ id: ticketId, status: "CANCELLED" });

        const secondPurchase = await requestApi(`/api/v1/trips/${tripId}/tickets`, {
            method: "POST",
            cookie: passengerSession.cookie,
            idempotencyKey: `e2e-second-purchase-${randomUUID()}`,
        });
        expect(secondPurchase.status).toBe(201);
        const activeTicketId = requireString(
            requireRecord(secondPurchase.body, "second purchased ticket"),
            "id",
        );

        for (const [status, expectedId] of [
            ["ACTIVE", activeTicketId],
            ["CANCELLED", ticketId],
        ] as const) {
            const filtered = await requestApi(
                `/api/v1/tickets/me?status=${status}&page=1&pageSize=10`,
                { cookie: passengerSession.cookie },
            );
            expect(filtered.status).toBe(200);
            const page = requireRecord(filtered.body, `${status} ticket list`);
            expect(page).toMatchObject({
                page: 1,
                pageSize: 10,
                totalItems: 1,
                totalPages: 1,
            });
            if (!Array.isArray(page.items)) {
                throw new Error(`Expected ${status} ticket list items to be an array`);
            }
            expect(
                page.items.map((item: unknown) => {
                    const ticket = requireRecord(item, "ticket");
                    return { id: ticket.id, status: ticket.status };
                }),
            ).toEqual([{ id: expectedId, status }]);
        }
    });
});
