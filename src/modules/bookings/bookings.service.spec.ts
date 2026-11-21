import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingsService } from "./bookings.service.js";
import type { BookingsRepository } from "./bookings.repository.js";
import {
    createBookingsRepository,
    createInlineIdempotencyStore,
    createLogger,
    createTicket,
    createTrip,
    createUser,
} from "../../../tests/test-helpers.js";

describe("BookingsService critical branches", () => {
    const passenger = createUser();
    const trip = createTrip();
    const ticket = createTicket({ passengerId: passenger.id, tripId: trip.id });
    let repository: BookingsRepository;
    let service: BookingsService;

    function setup(overrides: Partial<BookingsRepository> = {}): void {
        repository = createBookingsRepository(trip, ticket, overrides);
        service = new BookingsService(repository, createInlineIdempotencyStore(), createLogger());
    }

    beforeEach(() => setup());

    it("requires a valid idempotency key before reaching the repository", async () => {
        await expect(service.purchase(passenger, trip.id, undefined)).rejects.toBeInstanceOf(
            BadRequestException,
        );
        expect(repository.findTripForUpdate).not.toHaveBeenCalled();
    });

    it("purchases a seat and increments occupancy only after ticket creation", async () => {
        const result = await service.purchase(passenger, trip.id, "purchase-key-0001");

        expect(result).toMatchObject({ statusCode: 201, value: { id: ticket.id } });
        expect(repository.createTicket).toHaveBeenCalledWith(
            expect.objectContaining({
                passengerId: passenger.id,
                tripId: trip.id,
                price: trip.price,
                status: "ACTIVE",
                cancelledAt: null,
            }),
            expect.anything(),
        );
        expect(repository.adjustOccupiedSeats).toHaveBeenCalledWith(trip.id, 1, expect.anything());
    });

    it("rejects a purchase at the exact departure instant", async () => {
        const departureTime = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(departureTime);
        setup({
            findTripForUpdate: vi.fn(async () =>
                createTrip({ departureAt: new Date(departureTime).toISOString() }),
            ),
        });

        await expect(
            service.purchase(passenger, trip.id, "purchase-key-0006"),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(repository.createTicket).not.toHaveBeenCalled();
    });

    it("fails the purchase transaction if the created ticket cannot be read back", async () => {
        setup({ findTicketWithTrip: vi.fn(async () => undefined) });

        await expect(service.purchase(passenger, trip.id, "purchase-key-0005")).rejects.toThrow(
            "Purchased ticket was not found inside its transaction",
        );
    });

    it("rejects a missing trip", async () => {
        setup({ findTripForUpdate: vi.fn(async () => undefined) });

        await expect(
            service.purchase(passenger, trip.id, "purchase-key-0002"),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
        [
            "a departed trip",
            createTrip({ departureAt: new Date(Date.now() - 1_000).toISOString() }),
            undefined,
        ],
        ["a full trip", createTrip({ occupiedSeats: 2, capacity: 2 }), undefined],
        ["an already-active ticket", trip, ticket],
    ])("rejects purchase for %s", async (_case, purchaseTrip, activeTicket) => {
        const purchaseRepository = createBookingsRepository(purchaseTrip, ticket, {
            findActiveTicket: vi.fn(async () => activeTicket),
        });
        service = new BookingsService(
            purchaseRepository,
            createInlineIdempotencyStore(),
            createLogger(),
        );

        await expect(
            service.purchase(passenger, purchaseTrip.id, "purchase-key-0003"),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(purchaseRepository.createTicket).not.toHaveBeenCalled();
        expect(purchaseRepository.adjustOccupiedSeats).not.toHaveBeenCalled();
    });

    it("does not allow a passenger to inspect another passenger's ticket", async () => {
        setup();

        await expect(service.findById(ticket.id, passenger)).resolves.toMatchObject({
            id: ticket.id,
        });
        await expect(service.findById(ticket.id, createUser())).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        await expect(service.findById(ticket.id, createUser("ADMIN"))).resolves.toMatchObject({
            id: ticket.id,
        });
    });

    it("returns not found rather than exposing a missing ticket", async () => {
        setup({ findTicketWithTrip: vi.fn(async () => undefined) });

        await expect(service.findById(ticket.id, passenger)).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it("rejects cancellation when the ticket is missing or owned by another user", async () => {
        setup({ findTicket: vi.fn(async () => undefined) });
        await expect(
            service.cancel(ticket.id, passenger, "cancel-key-0001"),
        ).rejects.toBeInstanceOf(NotFoundException);

        setup();
        await expect(
            service.cancel(ticket.id, createUser(), "cancel-key-0002"),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(repository.findTripForUpdate).not.toHaveBeenCalled();
    });

    it.each([
        [
            "the trip disappeared",
            { findTripForUpdate: vi.fn(async () => undefined) },
            NotFoundException,
        ],
        [
            "the ticket disappeared",
            { findTicketForUpdate: vi.fn(async () => undefined) },
            NotFoundException,
        ],
        [
            "the ticket changed owner",
            {
                findTicketForUpdate: vi.fn(async () =>
                    createTicket({ passengerId: createUser().id }),
                ),
            },
            ForbiddenException,
        ],
        [
            "the ticket is no longer active",
            {
                findTicketForUpdate: vi.fn(async () =>
                    createTicket({ passengerId: passenger.id, status: "CANCELLED" }),
                ),
            },
            ConflictException,
        ],
        [
            "the trip has departed",
            {
                findTripForUpdate: vi.fn(async () =>
                    createTrip({ departureAt: new Date(Date.now() - 1_000).toISOString() }),
                ),
            },
            ConflictException,
        ],
    ])("rejects cancellation when %s", async (_case, overrides, expectedError) => {
        setup(overrides);

        await expect(
            service.cancel(ticket.id, passenger, "cancel-key-0003"),
        ).rejects.toBeInstanceOf(expectedError);
        expect(repository.cancelTicket).not.toHaveBeenCalled();
        expect(repository.adjustOccupiedSeats).not.toHaveBeenCalled();
    });

    it("cancels an active ticket and releases one seat", async () => {
        setup();

        const result = await service.cancel(ticket.id, passenger, "cancel-key-0004");

        expect(result).toMatchObject({ statusCode: 200, value: { id: ticket.id } });
        expect(repository.cancelTicket).toHaveBeenCalledWith(
            ticket.id,
            expect.any(String),
            expect.anything(),
        );
        expect(repository.adjustOccupiedSeats).toHaveBeenCalledWith(trip.id, -1, expect.anything());
    });

    it("rejects cancellation at the exact departure instant", async () => {
        const departureTime = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(departureTime);
        setup({
            findTripForUpdate: vi.fn(async () =>
                createTrip({ departureAt: new Date(departureTime).toISOString() }),
            ),
        });

        await expect(
            service.cancel(ticket.id, passenger, "cancel-key-0006"),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(repository.cancelTicket).not.toHaveBeenCalled();
    });

    it("fails the cancellation transaction if the cancelled ticket cannot be read back", async () => {
        setup({ findTicketWithTrip: vi.fn(async () => undefined) });

        await expect(service.cancel(ticket.id, passenger, "cancel-key-0005")).rejects.toThrow(
            "Cancelled ticket was not found inside its transaction",
        );
    });

    it("delegates the caller's ticket listing to the repository", async () => {
        setup();
        const query = { page: 2, pageSize: 5 };

        await service.listMine(passenger, query);

        expect(repository.listTickets).toHaveBeenCalledWith(passenger.id, query);
    });
});
