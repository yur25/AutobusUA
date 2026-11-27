import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { TripsService } from "./trips.service.js";
import type { TripsRepository } from "./trips.repository.js";
import {
    createInlineIdempotencyStore,
    createLogger,
    createTrip,
    createUser,
} from "../../../tests/test-helpers.js";

function createTripsRepository(overrides: Partial<TripsRepository> = {}): TripsRepository {
    const trip = createTrip();
    const defaults: TripsRepository = {
        create: vi.fn(async () => undefined),
        findById: vi.fn(async () => trip),
        search: vi.fn(async () => ({
            items: [trip],
            page: 1,
            pageSize: 20,
            totalItems: 1,
            totalPages: 1,
        })),
        listMine: vi.fn(async () => ({
            items: [trip],
            page: 1,
            pageSize: 20,
            totalItems: 1,
            totalPages: 1,
        })),
    };
    return { ...defaults, ...overrides };
}

describe("TripsService visibility and validation branches", () => {
    it("validates departure/arrival chronology and distinct non-empty route locations", async () => {
        const repository = createTripsRepository();
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );
        const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const later = new Date(Date.parse(future) + 60 * 60 * 1000).toISOString();
        const valid = {
            origin: " Kyiv ",
            destination: " Lviv ",
            departureAt: future,
            arrivalAt: later,
            price: "050.5",
            capacity: 2,
        };

        await expect(
            service.create(
                createUser("CARRIER"),
                { ...valid, departureAt: "invalid" },
                "trip-key-0001",
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(
                createUser("CARRIER"),
                {
                    ...valid,
                    departureAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                },
                "trip-key-0005",
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(
                createUser("CARRIER"),
                {
                    ...valid,
                    arrivalAt: new Date(Date.parse(future) - 1).toISOString(),
                },
                "trip-key-0006",
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(
                createUser("CARRIER"),
                { ...valid, origin: "Kyiv", destination: " kyiv " },
                "trip-key-0002",
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(createUser("CARRIER"), { ...valid, origin: "K" }, "trip-key-0007"),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(createUser("CARRIER"), { ...valid, destination: "L" }, "trip-key-0008"),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(createUser("CARRIER"), { ...valid, price: "0" }, "trip-key-0003"),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(createUser("CARRIER"), { ...valid, price: ".5" }, "trip-key-0009"),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(
                createUser("CARRIER"),
                { ...valid, price: "not-a-price" },
                "trip-key-0010",
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repository.create).not.toHaveBeenCalled();
    });

    it("rejects departure and arrival timestamps equal to their exclusive boundaries", async () => {
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);
        const repository = createTripsRepository();
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );
        const departureAt = new Date(now).toISOString();
        const arrivalAt = new Date(now + 60 * 60 * 1000).toISOString();
        const base = {
            origin: "Kyiv",
            destination: "Lviv",
            departureAt,
            arrivalAt,
            price: "50",
            capacity: 2,
        };

        await expect(
            service.create(createUser("CARRIER"), base, "trip-key-0014"),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.create(
                createUser("CARRIER"),
                {
                    ...base,
                    departureAt: new Date(now + 1).toISOString(),
                    arrivalAt: new Date(now + 1).toISOString(),
                },
                "trip-key-0015",
            ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repository.create).not.toHaveBeenCalled();
    });

    it("accepts route names at the minimum supported length", async () => {
        const repository = createTripsRepository();
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );
        const departureAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        await expect(
            service.create(
                createUser("CARRIER"),
                {
                    origin: "AB",
                    destination: "CD",
                    departureAt,
                    arrivalAt: new Date(Date.parse(departureAt) + 60 * 60 * 1000).toISOString(),
                    price: "1.5",
                    capacity: 2,
                },
                "trip-key-0016",
            ),
        ).resolves.toMatchObject({ statusCode: 201 });
    });

    it("normalizes the trip fields before persistence", async () => {
        const repository = createTripsRepository();
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );
        const departureAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        const result = await service.create(
            createUser("CARRIER"),
            {
                origin: " Kyiv ",
                destination: " Lviv ",
                departureAt,
                arrivalAt: new Date(Date.parse(departureAt) + 60 * 60 * 1000).toISOString(),
                price: "050.5",
                capacity: 2,
            },
            "trip-key-0004",
        );

        expect(result).toMatchObject({
            statusCode: 201,
            value: { origin: "Kyiv", destination: "Lviv", price: "50.50" },
        });
        expect(repository.create).toHaveBeenCalledWith(
            expect.objectContaining({
                origin: "Kyiv",
                destination: "Lviv",
                price: "50.50",
            }),
            expect.anything(),
        );
    });

    it("normalizes prices without removing interior zeros or only one leading zero", async () => {
        const repository = createTripsRepository();
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );
        const departureAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const base = {
            origin: "Kyiv",
            destination: "Lviv",
            departureAt,
            arrivalAt: new Date(Date.parse(departureAt) + 60 * 60 * 1000).toISOString(),
            capacity: 2,
        };

        await service.create(createUser("CARRIER"), { ...base, price: "100.5" }, "trip-key-0017");
        await service.create(createUser("CARRIER"), { ...base, price: "0050.5" }, "trip-key-0018");
        await service.create(createUser("CARRIER"), { ...base, price: "50" }, "trip-key-0019");

        expect(repository.create).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ price: "100.50" }),
            expect.anything(),
        );
        expect(repository.create).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ price: "50.50" }),
            expect.anything(),
        );
        expect(repository.create).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ price: "50.00" }),
            expect.anything(),
        );
    });

    it.each([
        [undefined, { kind: "AVAILABLE" }],
        [createUser("PASSENGER"), { kind: "AVAILABLE" }],
        [createUser("CARRIER"), { kind: "CARRIER" }],
        [createUser("ADMIN"), { kind: "ALL" }],
    ])("maps the caller role to the correct search visibility", async (user, expected) => {
        const repository = createTripsRepository();
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );

        await service.search({}, user);

        const visibility = vi.mocked(repository.search).mock.calls[0]?.[1];
        expect(visibility?.kind).toBe(expected.kind);
        if (user?.role === "CARRIER") {
            expect(visibility).toEqual({ kind: "CARRIER", carrierId: user.id });
        }
    });

    it("hides unavailable trips from passengers but allows an administrator to inspect them", async () => {
        const unavailableTrip = createTrip({
            departureAt: new Date(Date.now() - 1_000).toISOString(),
        });
        const repository = createTripsRepository({
            findById: vi.fn(async () => unavailableTrip),
        });
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );

        await expect(service.findById(unavailableTrip.id)).rejects.toBeInstanceOf(
            NotFoundException,
        );
        await expect(service.findById(unavailableTrip.id, createUser("ADMIN"))).resolves.toEqual(
            unavailableTrip,
        );
    });

    it("returns not found when the requested trip does not exist", async () => {
        const repository = createTripsRepository({
            findById: vi.fn(async () => undefined),
        });
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );

        await expect(service.findById("missing-trip-id")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("allows passengers to view available future trips but hides one at departure", async () => {
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);
        const availableTrip = createTrip({ departureAt: new Date(now + 1).toISOString() });
        const departedTrip = createTrip({ departureAt: new Date(now).toISOString() });
        const findById = vi
            .fn()
            .mockResolvedValueOnce(availableTrip)
            .mockResolvedValueOnce(departedTrip);
        const repository = createTripsRepository({ findById });
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );

        await expect(service.findById(availableTrip.id, createUser())).resolves.toEqual(
            availableTrip,
        );
        await expect(service.findById(departedTrip.id, createUser())).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it("shows a trip to its carrier but not to a different carrier", async () => {
        const trip = createTrip({ occupiedSeats: 2, capacity: 2 });
        const repository = createTripsRepository({
            findById: vi.fn(async () => trip),
        });
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );

        await expect(
            service.findById(trip.id, { ...createUser("CARRIER"), id: trip.carrierId }),
        ).resolves.toEqual(trip);
        await expect(service.findById(trip.id, createUser("CARRIER"))).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it("hides a full future trip from passengers", async () => {
        const fullTrip = createTrip({ occupiedSeats: 2, capacity: 2 });
        const repository = createTripsRepository({
            findById: vi.fn(async () => fullTrip),
        });
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );

        await expect(service.findById(fullTrip.id, createUser())).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it("validates the search date range before querying", async () => {
        const repository = createTripsRepository();
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );

        expect(() =>
            service.search({
                departureFrom: "2030-01-02T00:00:00Z",
                departureTo: "2030-01-01T00:00:00Z",
            }),
        ).toThrow(BadRequestException);
        expect(repository.search).not.toHaveBeenCalled();
    });

    it("allows single date bounds and equal inclusive bounds", async () => {
        const repository = createTripsRepository();
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );
        const bound = "2030-01-01T00:00:00Z";

        await service.search({ departureFrom: bound });
        await service.search({ departureTo: bound });
        await service.search({ departureFrom: bound, departureTo: bound });

        expect(repository.search).toHaveBeenCalledTimes(3);
    });

    it("delegates carrier-owned trip listing with the carrier ID and query", async () => {
        const carrier = createUser("CARRIER");
        const query = { page: 2, pageSize: 5 };
        const repository = createTripsRepository();
        const service = new TripsService(
            repository,
            createInlineIdempotencyStore(),
            createLogger(),
        );

        await service.listMine(carrier, query);

        expect(repository.listMine).toHaveBeenCalledWith(carrier.id, query);
    });
});
