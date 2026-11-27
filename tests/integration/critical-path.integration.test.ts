import { createHash, randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Trip, User, UserRole } from "../../src/common/domain.js";
import { DatabaseService } from "../../src/common/database.service.js";
import { executeIdempotently } from "../../src/common/idempotency.js";
import { PostgresIdempotencyStore } from "../../src/common/postgres-idempotency.store.js";
import { RequestContextService } from "../../src/common/request-context.service.js";
import { StructuredLogger } from "../../src/common/structured-logger.js";
import type { BookingsRepository } from "../../src/modules/bookings/bookings.repository.js";
import { PostgresBookingsRepository } from "../../src/modules/bookings/bookings.repository.js";
import { BookingsService } from "../../src/modules/bookings/bookings.service.js";
import { PostgresCarriersRepository } from "../../src/modules/carriers/carriers.repository.js";
import { CarriersService } from "../../src/modules/carriers/carriers.service.js";
import { PostgresAuthRepository } from "../../src/modules/auth/auth.repository.js";
import { PostgresTripsRepository } from "../../src/modules/trips/trips.repository.js";
import { createUser } from "../test-helpers.js";

describe("PostgreSQL booking transactions", () => {
    let database: DatabaseService;
    let logger: StructuredLogger;
    let idempotencyStore: PostgresIdempotencyStore;
    let bookingsRepository: PostgresBookingsRepository;
    let bookingsService: BookingsService;
    let carriersRepository: PostgresCarriersRepository;
    let carriersService: CarriersService;
    let authRepository: PostgresAuthRepository;
    let tripsRepository: PostgresTripsRepository;
    const userIds: string[] = [];
    const tripIds: string[] = [];

    beforeAll(async () => {
        const connectionString = process.env.TEST_DATABASE_URL;
        if (!connectionString) {
            throw new Error("Set TEST_DATABASE_URL to the dedicated autobusua_test database");
        }
        const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
        if (databaseName !== "autobusua_test") {
            throw new Error("Integration tests are restricted to the autobusua_test database");
        }

        process.env.DATABASE_URL = connectionString;
        logger = new StructuredLogger(new RequestContextService());
        logger.log = () => undefined;
        logger.debug = () => undefined;
        logger.warn = () => undefined;
        logger.error = () => undefined;
        logger.verbose = () => undefined;
        database = new DatabaseService(logger);
        await database.onModuleInit();
        idempotencyStore = new PostgresIdempotencyStore(database, logger);
        bookingsRepository = new PostgresBookingsRepository(database, logger);
        bookingsService = new BookingsService(bookingsRepository, idempotencyStore, logger);
        carriersRepository = new PostgresCarriersRepository(database, logger);
        carriersService = new CarriersService(carriersRepository, idempotencyStore, logger);
        authRepository = new PostgresAuthRepository(database, logger);
        tripsRepository = new PostgresTripsRepository(database, logger);
    }, 30_000);

    afterEach(async () => {
        if (userIds.length === 0) {
            return;
        }
        await database.query(
            "tests.cleanup.idempotency",
            "DELETE FROM idempotency_record WHERE user_id = ANY($1::uuid[])",
            [userIds],
        );
        await database.query(
            "tests.cleanup.tickets",
            `DELETE FROM ticket
             WHERE passenger_id = ANY($1::uuid[]) OR trip_id = ANY($2::uuid[])`,
            [userIds, tripIds],
        );
        await database.query(
            "tests.cleanup.carrier_applications",
            "DELETE FROM carrier_application WHERE applicant_id = ANY($1::uuid[])",
            [userIds],
        );
        await database.query("tests.cleanup.trips", "DELETE FROM trip WHERE id = ANY($1::uuid[])", [
            tripIds,
        ]);
        await database.query(
            "tests.cleanup.users",
            "DELETE FROM app_user WHERE id = ANY($1::uuid[])",
            [userIds],
        );
        userIds.length = 0;
        tripIds.length = 0;
    });

    afterAll(async () => {
        await database?.onApplicationShutdown();
    });

    async function insertUser(role: UserRole): Promise<User> {
        const user = {
            ...createUser(role),
            phone: `+380${Math.floor(Math.random() * 1_000_000_000)
                .toString()
                .padStart(9, "0")}`,
        };
        await database.query(
            "tests.insert_user",
            `INSERT INTO app_user (id, full_name, phone, password_hash, role)
             VALUES ($1, $2, $3, $4, $5)`,
            [user.id, user.fullName, user.phone, user.passwordHash, user.role],
        );
        userIds.push(user.id);
        return user;
    }

    async function createScenario(capacity = 1): Promise<{
        carrier: User;
        passengers: User[];
        trip: Trip;
    }> {
        const carrier = await insertUser("CARRIER");
        const passengers = await Promise.all([
            insertUser("PASSENGER"),
            ...(capacity === 1 ? [insertUser("PASSENGER")] : []),
        ]);
        const departureAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const tripId = randomUUID();
        const trip: Trip = {
            id: tripId,
            carrierId: carrier.id,
            origin: `Test Origin ${tripId.slice(0, 8)}`,
            destination: "Test Destination",
            departureAt,
            arrivalAt: new Date(Date.parse(departureAt) + 60 * 60 * 1000).toISOString(),
            price: "321.00",
            capacity,
            occupiedSeats: 0,
            createdAt: new Date().toISOString(),
        };
        await database.query(
            "tests.insert_trip",
            `INSERT INTO trip
                (id, carrier_id, origin, destination, departure_at, arrival_at,
                 price, capacity, occupied_seats, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)`,
            [
                trip.id,
                trip.carrierId,
                trip.origin,
                trip.destination,
                trip.departureAt,
                trip.arrivalAt,
                trip.price,
                trip.capacity,
                trip.createdAt,
            ],
        );
        tripIds.push(trip.id);
        return { carrier, passengers, trip };
    }

    async function countRows(
        table: "ticket" | "idempotency_record",
        where: string,
        values: unknown[],
    ): Promise<number> {
        const result = await database.query<{ count: string }>(
            `tests.count.${table}`,
            `SELECT count(*)::text AS count FROM ${table} WHERE ${where}`,
            values,
        );
        return Number(result.rows[0]?.count ?? 0);
    }

    async function insertTrip(trip: Trip): Promise<void> {
        await tripsRepository.create(trip, database);
        tripIds.push(trip.id);
    }

    it("serializes concurrent purchases of the last seat", async () => {
        const { passengers, trip } = await createScenario();
        const outcomes = await Promise.allSettled(
            passengers.map((passenger, index) =>
                bookingsService.purchase(passenger, trip.id, `last-seat-key-${index}-0001`),
            ),
        );
        const successes = outcomes.filter((result) => result.status === "fulfilled");
        const failures = outcomes.filter((result) => result.status === "rejected");

        expect(successes).toHaveLength(1);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.status === "rejected" && failures[0].reason).toBeInstanceOf(
            ConflictException,
        );
        expect(await countRows("ticket", "trip_id = $1 AND status = 'ACTIVE'", [trip.id])).toBe(1);
        const currentTrip = await database.query<{ occupied_seats: number }>(
            "tests.read_trip_occupancy",
            "SELECT occupied_seats FROM trip WHERE id = $1",
            [trip.id],
        );
        expect(currentTrip.rows[0]?.occupied_seats).toBe(1);
    });

    it("replays concurrent requests with the same idempotency key and payload", async () => {
        const { passengers, trip } = await createScenario(2);
        const passenger = passengers[0];
        if (!passenger) {
            throw new Error("Test scenario did not create its passenger");
        }
        const outcomes = await Promise.all([
            bookingsService.purchase(passenger, trip.id, "same-purchase-key-0001"),
            bookingsService.purchase(passenger, trip.id, "same-purchase-key-0001"),
        ]);

        expect(outcomes.map((result) => result.replayed).sort()).toEqual([false, true]);
        expect(outcomes[0]?.value.id).toBe(outcomes[1]?.value.id);
        expect(await countRows("ticket", "trip_id = $1", [trip.id])).toBe(1);
        const currentTrip = await database.query<{ occupied_seats: number }>(
            "tests.read_trip_occupancy",
            "SELECT occupied_seats FROM trip WHERE id = $1",
            [trip.id],
        );
        expect(currentTrip.rows[0]?.occupied_seats).toBe(1);
    });

    it("rejects reuse of an idempotency key with a different payload", async () => {
        const { passengers } = await createScenario();
        const passenger = passengers[0];
        if (!passenger) {
            throw new Error("Test scenario did not create its passenger");
        }
        const action = async () => ({ value: { accepted: true }, statusCode: 200 });

        await executeIdempotently(
            idempotencyStore,
            passenger.id,
            "integration.payload",
            "payload-key-0001",
            { value: 1 },
            action,
        );
        await expect(
            executeIdempotently(
                idempotencyStore,
                passenger.id,
                "integration.payload",
                "payload-key-0001",
                { value: 2 },
                action,
            ),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it("isolates idempotency replay for the same key and payload across users", async () => {
        const first = await insertUser("PASSENGER");
        const second = await insertUser("PASSENGER");
        const key = `shared-key-${randomUUID()}`;
        const operation = "integration.user-isolation";
        const execute = (user: User, currentOperation = operation, currentKey = key) =>
            executeIdempotently(
                idempotencyStore,
                user.id,
                currentOperation,
                currentKey,
                { same: true },
                async () => ({
                    value: { owner: user.id, operation: currentOperation, key: currentKey },
                    statusCode: 201,
                }),
            );

        expect(await execute(first)).toMatchObject({ replayed: false, value: { owner: first.id } });
        expect(await execute(second)).toMatchObject({
            replayed: false,
            value: { owner: second.id },
        });
        expect(await execute(first)).toMatchObject({ replayed: true, value: { owner: first.id } });
        expect(await execute(second)).toMatchObject({
            replayed: true,
            value: { owner: second.id },
        });
        const otherOperation = `${operation}.other`;
        const otherKey = `other-key-${randomUUID()}`;
        expect(await execute(first, otherOperation)).toMatchObject({ replayed: false });
        expect(await execute(first, operation, otherKey)).toMatchObject({ replayed: false });
        for (const [currentOperation, currentKey] of [
            [operation, key],
            [otherOperation, key],
            [operation, otherKey],
        ] as const) {
            expect(await execute(first, currentOperation, currentKey)).toMatchObject({
                replayed: true,
                value: { owner: first.id, operation: currentOperation, key: currentKey },
            });
        }
    });

    it("does not delete another user's expired idempotency key", async () => {
        const first = await insertUser("PASSENGER");
        const second = await insertUser("PASSENGER");
        const key = `shared-expired-${randomUUID()}`;
        const operation = `integration.expired-isolation.${randomUUID()}`;
        const expiredId = randomUUID();
        await database.query(
            "tests.insert_foreign_expired_idempotency",
            `INSERT INTO idempotency_record
                (id, user_id, operation, key_hash, request_hash, status,
                 response_status, response_body, completed_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, 'COMPLETED', 200, '{}'::jsonb,
                     now() - interval '2 days', now() - interval '1 day')`,
            [
                expiredId,
                first.id,
                operation,
                createHash("sha256").update(key).digest("hex"),
                "1".repeat(64),
            ],
        );
        expect(
            await executeIdempotently(
                idempotencyStore,
                second.id,
                operation,
                key,
                {},
                async () => ({
                    value: { owner: second.id },
                    statusCode: 201,
                }),
            ),
        ).toMatchObject({ replayed: false, value: { owner: second.id } });
        expect(await countRows("idempotency_record", "id = $1", [expiredId])).toBe(1);
    });

    it("reuses an expired key only after deleting its expired record", async () => {
        const { passengers } = await createScenario();
        const passenger = passengers[0];
        if (!passenger) {
            throw new Error("Test scenario did not create its passenger");
        }
        const key = "expired-reuse-key-0001";
        const keyHash = createHash("sha256").update(key).digest("hex");
        await database.query(
            "tests.insert_expired_idempotency",
            `INSERT INTO idempotency_record
                (id, user_id, operation, key_hash, request_hash, status,
                 response_status, response_body, completed_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, 'COMPLETED', 200, '{}'::jsonb,
                     now() - interval '2 days', now() - interval '1 day')`,
            [randomUUID(), passenger.id, "integration.expired", keyHash, "1".repeat(64)],
        );

        const result = await executeIdempotently(
            idempotencyStore,
            passenger.id,
            "integration.expired",
            key,
            { fresh: true },
            async () => ({ value: { fresh: true }, statusCode: 201 }),
        );

        expect(result).toMatchObject({
            replayed: false,
            statusCode: 201,
            value: { fresh: true },
        });
        expect(
            await countRows(
                "idempotency_record",
                "user_id = $1 AND operation = $2 AND key_hash = $3",
                [passenger.id, "integration.expired", keyHash],
            ),
        ).toBe(1);
    });

    it("cleans expired records in a rolled-back transaction", async () => {
        const expiredCompletedId = randomUUID();
        const expiredInProgressId = randomUUID();
        const unexpiredId = randomUUID();
        const cleanupStore = new PostgresIdempotencyStore(database, logger);
        const rollback = new Error("roll back cleanup verification");
        await expect(
            database.withTransaction("tests.cleanup_idempotency_rollback", async (executor) => {
                await executor.query(
                    "tests.create_isolated_cleanup_table",
                    `CREATE TEMP TABLE idempotency_record
                     (LIKE idempotency_record INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
                     ON COMMIT DROP`,
                );
                const table = await executor.query<{ isolated: boolean }>(
                    "tests.verify_isolated_cleanup_table",
                    `SELECT to_regclass('idempotency_record') = to_regclass('pg_temp.idempotency_record') AS isolated`,
                );
                expect(table.rows[0]?.isolated).toBe(true);
                await executor.query(
                    "tests.insert_cleanup_idempotency_records",
                    `INSERT INTO idempotency_record
                        (id, user_id, operation, key_hash, request_hash, status,
                         response_status, response_body, completed_at, expires_at)
                     VALUES
                        ($1, $2, 'integration.cleanup.completed', $3, $4, 'COMPLETED',
                         200, '{}'::jsonb, now() - interval '2 days', now() - interval '1 day'),
                        ($5, $2, 'integration.cleanup.in_progress', $6, $4, 'IN_PROGRESS',
                         NULL, NULL, NULL, now() - interval '1 day'),
                        ($7, $2, 'integration.cleanup.unexpired', $8, $4, 'COMPLETED',
                         200, '{}'::jsonb, now(), now() + interval '1 day')`,
                    [
                        expiredCompletedId,
                        randomUUID(),
                        createHash("sha256").update(expiredCompletedId).digest("hex"),
                        "2".repeat(64),
                        expiredInProgressId,
                        createHash("sha256").update(expiredInProgressId).digest("hex"),
                        unexpiredId,
                        createHash("sha256").update(unexpiredId).digest("hex"),
                    ],
                );
                await cleanupStore.cleanupExpiredRecordsOnce(executor);
                const remaining = await executor.query<{ id: string }>(
                    "tests.check_cleanup_in_transaction",
                    "SELECT id FROM idempotency_record ORDER BY id",
                );
                expect(remaining.rows.map((row) => row.id)).toEqual(
                    [expiredInProgressId, unexpiredId].sort(),
                );
                throw rollback;
            }),
        ).rejects.toBe(rollback);

        expect(
            await countRows("idempotency_record", "id = ANY($1::uuid[])", [
                [expiredCompletedId, expiredInProgressId, unexpiredId],
            ]),
        ).toBe(0);
    });

    it("cancels once, restores capacity, and replays the original cancellation", async () => {
        const { passengers, trip } = await createScenario();
        const passenger = passengers[0];
        if (!passenger) {
            throw new Error("Test scenario did not create its passenger");
        }
        const purchase = await bookingsService.purchase(
            passenger,
            trip.id,
            "cancel-flow-purchase-0001",
        );
        const activeTickets = await bookingsRepository.listTickets(passenger.id, {
            status: "ACTIVE",
            page: 1,
            pageSize: 10,
        });
        const firstCancellation = await bookingsService.cancel(
            purchase.value.id,
            passenger,
            "cancel-flow-cancel-0001",
        );
        const cancelledTickets = await bookingsRepository.listTickets(passenger.id, {
            status: "CANCELLED",
            page: 1,
            pageSize: 10,
        });
        const replay = await bookingsService.cancel(
            purchase.value.id,
            passenger,
            "cancel-flow-cancel-0001",
        );

        expect(firstCancellation.value.status).toBe("CANCELLED");
        expect(replay.replayed).toBe(true);
        expect(activeTickets.totalItems).toBe(1);
        expect(cancelledTickets.totalItems).toBe(1);
        expect(cancelledTickets.items[0]?.id).toBe(purchase.value.id);
        expect(await countRows("ticket", "trip_id = $1 AND status = 'ACTIVE'", [trip.id])).toBe(0);
        const currentTrip = await database.query<{ occupied_seats: number }>(
            "tests.read_trip_occupancy",
            "SELECT occupied_seats FROM trip WHERE id = $1",
            [trip.id],
        );
        expect(currentTrip.rows[0]?.occupied_seats).toBe(0);
    });

    it("filters ticket items and counts by status before pagination", async () => {
        const { passengers, trip } = await createScenario();
        const passenger = passengers[0];
        if (!passenger) {
            throw new Error("Test scenario did not create its passenger");
        }

        const cancelled = await bookingsService.purchase(
            passenger,
            trip.id,
            "status-filter-purchase-0001",
        );
        await bookingsService.cancel(cancelled.value.id, passenger, "status-filter-cancel-0001");
        const active = await bookingsService.purchase(
            passenger,
            trip.id,
            "status-filter-purchase-0002",
        );

        for (const [status, expectedId] of [
            ["ACTIVE", active.value.id],
            ["CANCELLED", cancelled.value.id],
        ] as const) {
            const firstPage = await bookingsRepository.listTickets(passenger.id, {
                status,
                page: 1,
                pageSize: 1,
            });
            const secondPage = await bookingsRepository.listTickets(passenger.id, {
                status,
                page: 2,
                pageSize: 1,
            });

            expect(
                firstPage.items.map((ticket) => ({ id: ticket.id, status: ticket.status })),
            ).toEqual([{ id: expectedId, status }]);
            expect(firstPage).toMatchObject({ page: 1, pageSize: 1, totalItems: 1, totalPages: 1 });
            expect(secondPage).toMatchObject({
                items: [],
                page: 2,
                pageSize: 1,
                totalItems: 1,
                totalPages: 1,
            });
        }

        const unfiltered = await bookingsRepository.listTickets(passenger.id, { pageSize: 10 });
        expect(unfiltered.items.map((ticket) => ticket.id).sort()).toEqual(
            [active.value.id, cancelled.value.id].sort(),
        );
        expect(unfiltered.totalItems).toBe(2);
    });

    it("isolates ticket items and counts by passenger before pagination", async () => {
        const { passengers, trip } = await createScenario(2);
        const firstPassenger = passengers[0];
        if (!firstPassenger) {
            throw new Error("Test scenario did not create its passenger");
        }
        const secondPassenger = await insertUser("PASSENGER");
        const emptyPassenger = await insertUser("PASSENGER");
        const firstTicket = await bookingsService.purchase(
            firstPassenger,
            trip.id,
            "ticket-owner-first-0001",
        );
        const secondTicket = await bookingsService.purchase(
            secondPassenger,
            trip.id,
            "ticket-owner-second-0001",
        );

        for (const [passenger, ticket] of [
            [firstPassenger, firstTicket.value],
            [secondPassenger, secondTicket.value],
        ] as const) {
            for (const filter of [{ status: "ACTIVE" as const }, {}]) {
                const firstPage = await bookingsRepository.listTickets(passenger.id, {
                    ...filter,
                    page: 1,
                    pageSize: 10,
                });
                const secondPage = await bookingsRepository.listTickets(passenger.id, {
                    ...filter,
                    page: 2,
                    pageSize: 1,
                });
                expect(
                    firstPage.items.map((item) => ({
                        id: item.id,
                        passengerId: item.passengerId,
                        status: item.status,
                    })),
                ).toEqual([{ id: ticket.id, passengerId: passenger.id, status: "ACTIVE" }]);
                expect(firstPage).toMatchObject({
                    page: 1,
                    pageSize: 10,
                    totalItems: 1,
                    totalPages: 1,
                });
                expect(secondPage).toMatchObject({
                    items: [],
                    page: 2,
                    pageSize: 1,
                    totalItems: 1,
                    totalPages: 1,
                });
            }
        }

        const emptyPage = await bookingsRepository.listTickets(emptyPassenger.id, {
            status: "ACTIVE",
        });
        expect(emptyPage).toMatchObject({ items: [], totalItems: 0, totalPages: 0 });
    });

    it("rolls back the ticket and idempotency record if a later transaction step fails", async () => {
        const { passengers, trip } = await createScenario();
        const passenger = passengers[0];
        if (!passenger) {
            throw new Error("Test scenario did not create its passenger");
        }
        const failure = new Error("forced seat-counter failure");
        const failingRepository = new Proxy<BookingsRepository>(bookingsRepository, {
            get(target, property, receiver) {
                if (property === "adjustOccupiedSeats") {
                    return async () => {
                        throw failure;
                    };
                }
                const value: unknown = Reflect.get(target, property, receiver);
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        const failingService = new BookingsService(failingRepository, idempotencyStore, logger);

        await expect(
            failingService.purchase(passenger, trip.id, "rollback-purchase-key-0001"),
        ).rejects.toBe(failure);
        expect(await countRows("ticket", "trip_id = $1", [trip.id])).toBe(0);
        expect(
            await countRows("idempotency_record", "user_id = $1 AND operation = $2", [
                passenger.id,
                `ticket.purchase:${trip.id}`,
            ]),
        ).toBe(0);
        const currentTrip = await database.query<{ occupied_seats: number }>(
            "tests.read_trip_occupancy",
            "SELECT occupied_seats FROM trip WHERE id = $1",
            [trip.id],
        );
        expect(currentTrip.rows[0]?.occupied_seats).toBe(0);
    });

    it("isolates applicant application items and counts before pagination", async () => {
        const firstApplicant = await insertUser("PASSENGER");
        const secondApplicant = await insertUser("PASSENGER");
        const admin = await insertUser("ADMIN");
        const first = await carriersService.apply(firstApplicant, "applicant-list-first-0001");
        await carriersService.review(
            first.value.id,
            admin,
            "REJECTED",
            "applicant-list-reject-0001",
            "Incomplete documents",
        );
        const second = await carriersService.apply(firstApplicant, "applicant-list-second-0001");
        const foreign = await carriersService.apply(secondApplicant, "applicant-list-other-0001");

        const firstPage = await carriersRepository.findApplicationsByApplicant(firstApplicant.id, {
            page: 1,
            pageSize: 1,
        });
        const secondPage = await carriersRepository.findApplicationsByApplicant(firstApplicant.id, {
            page: 2,
            pageSize: 1,
        });
        const thirdPage = await carriersRepository.findApplicationsByApplicant(firstApplicant.id, {
            page: 3,
            pageSize: 1,
        });
        expect([...firstPage.items, ...secondPage.items].map((item) => item.id).sort()).toEqual(
            [first.value.id, second.value.id].sort(),
        );
        expect(firstPage).toMatchObject({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 });
        expect(secondPage).toMatchObject({ page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });
        expect(thirdPage).toMatchObject({
            items: [],
            page: 3,
            pageSize: 1,
            totalItems: 2,
            totalPages: 2,
        });

        const otherPage = await carriersRepository.findApplicationsByApplicant(secondApplicant.id, {
            pageSize: 10,
        });
        expect(otherPage.items.map((item) => item.id)).toEqual([foreign.value.id]);
        expect(otherPage).toMatchObject({ totalItems: 1, totalPages: 1 });
        const emptyPage = await carriersRepository.findApplicationsByApplicant(admin.id, {});
        expect(emptyPage).toMatchObject({ items: [], totalItems: 0, totalPages: 0 });
    });

    it("filters administrator application items and counts by status before pagination", async () => {
        const first = await insertUser("PASSENGER");
        const second = await insertUser("PASSENGER");
        const admin = await insertUser("ADMIN");
        const rejected = await carriersService.apply(first, "admin-status-application-0001");
        await carriersService.review(
            rejected.value.id,
            admin,
            "REJECTED",
            "admin-status-review-0001",
        );
        const pending = await carriersService.apply(second, "admin-status-application-0002");

        for (const [status, included, excluded] of [
            ["PENDING", pending.value.id, rejected.value.id],
            ["REJECTED", rejected.value.id, pending.value.id],
        ] as const) {
            const expected = await database.query<{ id: string }>(
                "tests.expected_application_status",
                "SELECT id FROM carrier_application WHERE status = $1",
                [status],
            );
            const expectedIds = expected.rows.map((row) => row.id).sort();
            const ids: string[] = [];
            let pageNumber = 1;
            while (true) {
                const page = await carriersRepository.listApplications(status, {
                    page: pageNumber,
                    pageSize: 100,
                });
                expect(page.totalItems).toBe(expectedIds.length);
                expect(page.totalPages).toBe(Math.ceil(expectedIds.length / 100));
                expect(page.items.every((item) => item.status === status)).toBe(true);
                ids.push(...page.items.map((item) => item.id));
                if (page.items.length < 100) break;
                pageNumber++;
            }
            expect(ids.sort()).toEqual(expectedIds);
            expect(ids).toContain(included);
            expect(ids).not.toContain(excluded);
        }
    });

    it("promotes a passenger and verifies their application in one transaction", async () => {
        const applicant = await insertUser("PASSENGER");
        const admin = await insertUser("ADMIN");
        const submission = await carriersService.apply(applicant, "carrier-application-key-0001");
        await expect(
            carriersService.apply(applicant, "carrier-application-key-0002"),
        ).rejects.toBeInstanceOf(ConflictException);

        const reviewed = await carriersService.review(
            submission.value.id,
            admin,
            "VERIFIED",
            "carrier-review-key-0001",
        );
        const account = await database.query<{ role: UserRole }>(
            "tests.read_promoted_account",
            "SELECT role FROM app_user WHERE id = $1",
            [applicant.id],
        );

        expect(reviewed.value.status).toBe("VERIFIED");
        expect(account.rows[0]?.role).toBe("CARRIER");
        expect(reviewed.value.reviewedBy).toBe(admin.id);
        await expect(
            carriersService.review(
                submission.value.id,
                admin,
                "VERIFIED",
                "carrier-review-key-0002",
            ),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects an application without promoting the passenger", async () => {
        const applicant = await insertUser("PASSENGER");
        const admin = await insertUser("ADMIN");
        const submission = await carriersService.apply(
            applicant,
            "carrier-rejection-application-0001",
        );

        const reviewed = await carriersService.review(
            submission.value.id,
            admin,
            "REJECTED",
            "carrier-rejection-review-0001",
            "Incomplete documents",
        );
        const account = await database.query<{ role: UserRole }>(
            "tests.read_rejected_account",
            "SELECT role FROM app_user WHERE id = $1",
            [applicant.id],
        );

        expect(reviewed.value.status).toBe("REJECTED");
        expect(reviewed.value.rejectionReason).toBe("Incomplete documents");
        expect(account.rows[0]?.role).toBe("PASSENGER");
    });

    it("does not promote a user whose role changed before application review", async () => {
        const applicant = await insertUser("PASSENGER");
        const admin = await insertUser("ADMIN");
        const submission = await carriersService.apply(
            applicant,
            "carrier-stale-role-application-0001",
        );
        await database.query(
            "tests.change_applicant_role",
            "UPDATE app_user SET role = 'ADMIN' WHERE id = $1",
            [applicant.id],
        );

        await expect(
            carriersService.review(
                submission.value.id,
                admin,
                "VERIFIED",
                "carrier-stale-role-review-0001",
            ),
        ).rejects.toBeInstanceOf(ConflictException);
        const application = await carriersRepository.findApplication(submission.value.id);
        expect(application?.status).toBe("PENDING");
    });

    it("translates the database phone unique constraint into a clean duplicate result", async () => {
        const existing = await insertUser("PASSENGER");
        const duplicate = { ...createUser("PASSENGER"), phone: existing.phone };

        await expect(authRepository.createUser(duplicate)).resolves.toBe(false);
        const matchingUsers = await database.query<{ count: string }>(
            "tests.count_duplicate_phone",
            "SELECT count(*)::text AS count FROM app_user WHERE phone = $1",
            [existing.phone],
        );
        expect(Number(matchingUsers.rows[0]?.count)).toBe(1);
    });

    it("enforces booking repository constraints for duplicate tickets and capacity", async () => {
        const { passengers, trip } = await createScenario();
        const passenger = passengers[0];
        if (!passenger) {
            throw new Error("Test scenario did not create its passenger");
        }
        const purchase = await bookingsService.purchase(
            passenger,
            trip.id,
            "repository-constraint-purchase-0001",
        );
        const duplicate = {
            id: randomUUID(),
            passengerId: passenger.id,
            tripId: trip.id,
            price: trip.price,
            status: "ACTIVE" as const,
            purchasedAt: new Date().toISOString(),
            cancelledAt: null,
        };

        await expect(
            database.withTransaction("tests.duplicate_ticket", (executor) =>
                bookingsRepository.createTicket(duplicate, executor),
            ),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
            database.withTransaction("tests.full_trip_increment", (executor) =>
                bookingsRepository.adjustOccupiedSeats(trip.id, 1, executor),
            ),
        ).rejects.toBeInstanceOf(ConflictException);
        await bookingsService.cancel(
            purchase.value.id,
            passenger,
            "repository-constraint-cancel-0001",
        );
        await expect(
            database.withTransaction("tests.repeat_ticket_cancel", (executor) =>
                bookingsRepository.cancelTicket(
                    purchase.value.id,
                    new Date().toISOString(),
                    executor,
                ),
            ),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it("persists, finds, and deletes an authentication session", async () => {
        const user = await insertUser("PASSENGER");
        const session = {
            idHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
            userId: user.id,
            expiresAt: Date.now() + 60_000,
        };

        await authRepository.createSession(session);
        await expect(authRepository.findUserByPhone(user.phone)).resolves.toMatchObject({
            id: user.id,
        });
        await expect(authRepository.findUserById(user.id)).resolves.toMatchObject({
            role: "PASSENGER",
        });
        await expect(authRepository.findSession(session.idHash)).resolves.toEqual(session);
        await authRepository.deleteSession(session.idHash);
        await expect(authRepository.findSession(session.idHash)).resolves.toBeUndefined();
    });

    it("applies database trip visibility filters before returning search results", async () => {
        const { carrier, passengers, trip } = await createScenario();
        const passenger = passengers[0];
        if (!passenger) {
            throw new Error("Test scenario did not create its passenger");
        }
        await bookingsService.purchase(passenger, trip.id, "trip-search-purchase-0001");

        const otherCarrier = await insertUser("CARRIER");
        const otherTrip: Trip = {
            ...trip,
            id: randomUUID(),
            carrierId: otherCarrier.id,
            capacity: 2,
            occupiedSeats: 0,
        };
        await tripsRepository.create(otherTrip, database);
        tripIds.push(otherTrip.id);

        const query = { origin: trip.origin };
        const available = await tripsRepository.search(query, { kind: "AVAILABLE" });
        const carrierTrips = await tripsRepository.search(query, {
            kind: "CARRIER",
            carrierId: carrier.id,
        });
        const allTrips = await tripsRepository.search(query, { kind: "ALL" });
        const mine = await tripsRepository.listMine(carrier.id, {});

        expect(available.items.map((item) => item.id)).toEqual([otherTrip.id]);
        expect(carrierTrips.items.map((item) => item.id)).toEqual([trip.id]);
        expect(allTrips.items.map((item) => item.id).sort()).toEqual(
            [trip.id, otherTrip.id].sort(),
        );
        expect(mine.items.map((item) => item.id)).toEqual([trip.id]);
    });

    it("filters trip visibility and owner counts before pagination", async () => {
        const { carrier, passengers, trip } = await createScenario();
        const passenger = passengers[0];
        if (!passenger) throw new Error("Test scenario did not create its passenger");
        await bookingsService.purchase(passenger, trip.id, "visibility-full-seat-0001");

        const otherCarrier = await insertUser("CARRIER");
        const future = new Date(Date.parse(trip.departureAt) + 60_000).toISOString();
        const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const available = { ...trip, id: randomUUID(), departureAt: future };
        const foreign = { ...available, id: randomUUID(), carrierId: otherCarrier.id };
        const departed = {
            ...trip,
            id: randomUUID(),
            departureAt: past,
            arrivalAt: new Date(Date.parse(past) + 60 * 60 * 1000).toISOString(),
        };
        await insertTrip(available);
        await insertTrip(foreign);
        await insertTrip(departed);

        const searchQuery = { origin: trip.origin, pageSize: 10 };
        for (const [visibility, ids] of [
            [{ kind: "AVAILABLE" as const }, [available.id, foreign.id]],
            [
                { kind: "CARRIER" as const, carrierId: carrier.id },
                [trip.id, available.id, departed.id],
            ],
            [{ kind: "ALL" as const }, [trip.id, available.id, foreign.id, departed.id]],
        ] as const) {
            const result = await tripsRepository.search(searchQuery, visibility);
            expect(result.items.map((item) => item.id).sort()).toEqual([...ids].sort());
            expect(result.totalItems).toBe(ids.length);
            const emptyPage = await tripsRepository.search(
                { ...searchQuery, page: ids.length + 1, pageSize: 1 },
                visibility,
            );
            expect(emptyPage).toMatchObject({
                items: [],
                totalItems: ids.length,
                totalPages: ids.length,
            });
        }

        const firstPage = await tripsRepository.listMine(carrier.id, { page: 1, pageSize: 2 });
        const secondPage = await tripsRepository.listMine(carrier.id, { page: 2, pageSize: 2 });
        expect([...firstPage.items, ...secondPage.items].map((item) => item.id).sort()).toEqual(
            [trip.id, available.id, departed.id].sort(),
        );
        expect(firstPage).toMatchObject({ totalItems: 3, totalPages: 2 });
        expect(secondPage).toMatchObject({ totalItems: 3, totalPages: 2 });
        expect(
            await tripsRepository.listMine(otherCarrier.id, { page: 2, pageSize: 1 }),
        ).toMatchObject({
            items: [],
            totalItems: 1,
            totalPages: 1,
        });
    });

    it("applies route and inclusive departure filters before trip pagination", async () => {
        const { trip } = await createScenario();
        const marker = randomUUID();
        const origin = `Origin ${marker}`;
        const destination = `Destination ${marker}`;
        const start = Date.now() + 24 * 60 * 60 * 1000;
        const times = [-1, 0, 1, 2, 3].map((hours) =>
            new Date(start + hours * 60 * 60 * 1000).toISOString(),
        );
        const matching: Trip[] = [];
        for (const time of times) {
            const candidate = {
                ...trip,
                id: randomUUID(),
                origin,
                destination,
                departureAt: time,
                arrivalAt: new Date(Date.parse(time) + 60 * 60 * 1000).toISOString(),
            };
            await insertTrip(candidate);
            matching.push(candidate);
        }
        const firstMatching = matching[0];
        const from = times[1];
        const to = times[3];
        if (!firstMatching || !from || !to) throw new Error("Expected route fixtures");
        await insertTrip({ ...firstMatching, id: randomUUID(), origin: `Other ${marker}` });
        await insertTrip({ ...firstMatching, id: randomUUID(), destination: `Other ${marker}` });

        const route = {
            origin: `  ${origin.toUpperCase()}  `,
            destination: destination.toUpperCase(),
        };
        for (const [range, expected] of [
            [{}, matching],
            [{ departureFrom: from }, matching.slice(1)],
            [{ departureTo: to }, matching.slice(0, 4)],
            [{ departureFrom: from, departureTo: to }, matching.slice(1, 4)],
        ] as const) {
            const first = await tripsRepository.search(
                { ...route, ...range, pageSize: 2 },
                { kind: "ALL" },
            );
            const second = await tripsRepository.search(
                { ...route, ...range, page: 2, pageSize: 2 },
                { kind: "ALL" },
            );
            expect(first.items.map((item) => item.id)).toEqual(
                expected.slice(0, 2).map((item) => item.id),
            );
            expect(second.items.map((item) => item.id)).toEqual(
                expected.slice(2, 4).map((item) => item.id),
            );
            expect(first.totalItems).toBe(expected.length);
            expect(second.totalItems).toBe(expected.length);
            expect(first.totalPages).toBe(Math.ceil(expected.length / 2));
        }
    });

    it("keeps user and session lookups and logout isolated", async () => {
        const first = await insertUser("PASSENGER");
        const second = await insertUser("CARRIER");
        const sessions = [first, second].map((user) => ({
            idHash: createHash("sha256").update(randomUUID()).digest("hex"),
            userId: user.id,
            expiresAt: Date.now() + 60_000,
        }));
        const [firstSession, secondSession] = sessions;
        if (!firstSession || !secondSession) throw new Error("Expected two sessions");
        await authRepository.createSession(firstSession);
        await authRepository.createSession(secondSession);

        for (const [user, session] of [
            [first, firstSession],
            [second, secondSession],
        ] as const) {
            expect((await authRepository.findUserByPhone(user.phone))?.id).toBe(user.id);
            expect((await authRepository.findUserById(user.id))?.id).toBe(user.id);
            expect(await authRepository.findSession(session.idHash)).toEqual(session);
        }
        expect(await authRepository.findUserById(randomUUID())).toBeUndefined();
        expect(await authRepository.findUserByPhone(`missing-${randomUUID()}`)).toBeUndefined();
        expect(
            await authRepository.findSession(
                createHash("sha256").update(randomUUID()).digest("hex"),
            ),
        ).toBeUndefined();
        await authRepository.deleteSession(firstSession.idHash);
        expect(await authRepository.findSession(firstSession.idHash)).toBeUndefined();
        expect(await authRepository.findSession(secondSession.idHash)).toEqual(secondSession);
    });

    it("allows one passenger to hold active tickets for different trips", async () => {
        const { passengers, trip } = await createScenario(2);
        const passenger = passengers[0];
        if (!passenger) throw new Error("Test scenario did not create its passenger");
        const otherPassenger = await insertUser("PASSENGER");
        const secondTrip = { ...trip, id: randomUUID() };
        await insertTrip(secondTrip);
        const first = await bookingsService.purchase(
            passenger,
            trip.id,
            "different-trip-purchase-0001",
        );
        const other = await bookingsService.purchase(
            otherPassenger,
            trip.id,
            "different-passenger-purchase-0001",
        );
        const second = await bookingsService.purchase(
            passenger,
            secondTrip.id,
            "different-trip-purchase-0002",
        );
        expect(first.value.tripId).toBe(trip.id);
        expect(second.value.tripId).toBe(secondTrip.id);
        expect(second.value.id).not.toBe(first.value.id);
        expect(
            await bookingsRepository.findActiveTicket(passenger.id, trip.id, database),
        ).toMatchObject({ id: first.value.id });
        expect(
            await bookingsRepository.findActiveTicket(passenger.id, secondTrip.id, database),
        ).toMatchObject({ id: second.value.id });
        await bookingsService.cancel(first.value.id, passenger, "different-trip-cancel-0001");
        expect(
            await bookingsRepository.findActiveTicket(passenger.id, trip.id, database),
        ).toBeUndefined();
        expect(
            await bookingsRepository.findActiveTicket(otherPassenger.id, trip.id, database),
        ).toMatchObject({ id: other.value.id });
    });
});
