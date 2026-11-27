import { randomUUID } from "node:crypto";
import { RequestContextService } from "../src/common/request-context.service.js";
import { StructuredLogger } from "../src/common/structured-logger.js";
import type { Ticket, Trip, User, UserRole } from "../src/common/domain.js";
import type { BookingsRepository } from "../src/modules/bookings/bookings.repository.js";
import type { IdempotencyStore } from "../src/common/idempotency.js";
import type { SqlExecutor } from "../src/common/database.service.js";
import { vi } from "vitest";

export function createUser(role: UserRole = "PASSENGER", id = randomUUID()): User {
    return {
        id,
        fullName: "Test Passenger",
        phone: "+380501234567",
        passwordHash: "test-hash",
        role,
        createdAt: new Date().toISOString(),
    };
}

export function createTrip(overrides: Partial<Trip> = {}): Trip {
    const departureAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return {
        id: randomUUID(),
        carrierId: randomUUID(),
        origin: "Kyiv",
        destination: "Lviv",
        departureAt,
        arrivalAt: new Date(Date.parse(departureAt) + 2 * 60 * 60 * 1000).toISOString(),
        price: "500.00",
        capacity: 2,
        occupiedSeats: 0,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

export function createTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: randomUUID(),
        passengerId: randomUUID(),
        tripId: randomUUID(),
        price: "500.00",
        status: "ACTIVE",
        purchasedAt: new Date().toISOString(),
        cancelledAt: null,
        ...overrides,
    };
}

export function createLogger(): StructuredLogger {
    const logger = new StructuredLogger(new RequestContextService());
    vi.spyOn(logger, "log").mockImplementation(() => undefined);
    vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vi.spyOn(logger, "verbose").mockImplementation(() => undefined);
    return logger;
}

const executor: SqlExecutor = {
    async query() {
        return { rows: [], rowCount: 0 };
    },
};

export function createInlineIdempotencyStore(): IdempotencyStore {
    return {
        async executeIdempotently<T>(
            _userId: string,
            _operation: string,
            _keyHash: string,
            _requestHash: string,
            action: (executor: SqlExecutor) => Promise<{ value: T; statusCode: number }>,
        ): Promise<{ value: T; statusCode: number; replayed: boolean }> {
            return { ...(await action(executor)), replayed: false };
        },
    };
}

export function createBookingsRepository(
    trip: Trip,
    ticket: Ticket,
    overrides: Partial<BookingsRepository> = {},
): BookingsRepository {
    const defaults: BookingsRepository = {
        findTripForUpdate: vi.fn(async () => trip),
        findTicket: vi.fn(async () => ticket),
        findTicketForUpdate: vi.fn(async () => ticket),
        findTicketWithTrip: vi.fn(async () => ({ ...ticket, trip })),
        findActiveTicket: vi.fn(async () => undefined),
        createTicket: vi.fn(async () => undefined),
        cancelTicket: vi.fn(async () => undefined),
        adjustOccupiedSeats: vi.fn(async () => undefined),
        listTickets: vi.fn(async () => ({
            items: [],
            page: 1,
            pageSize: 20,
            totalItems: 0,
            totalPages: 0,
        })),
    };
    return { ...defaults, ...overrides };
}
