import {
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
    executeIdempotently,
    IDEMPOTENCY_STORE,
    type IdempotencyStore,
} from "../../common/idempotency.js";
import { StructuredLogger } from "../../common/structured-logger.js";
import type { Ticket, User } from "../../common/domain.js";
import { BOOKINGS_REPOSITORY, type BookingsRepository } from "./bookings.repository.js";
import type { TicketQueryDto } from "./bookings.dto.js";

@Injectable()
export class BookingsService {
    constructor(
        @Inject(BOOKINGS_REPOSITORY) private readonly repository: BookingsRepository,
        @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyStore,
        private readonly logger: StructuredLogger,
    ) {}

    async purchase(passenger: User, tripId: string, key: string | undefined) {
        return executeIdempotently(
            this.idempotencyStore,
            passenger.id,
            `ticket.purchase:${tripId}`,
            key,
            { tripId },
            async (executor) => {
                const trip = await this.repository.findTripForUpdate(tripId, executor);
                if (!trip) {
                    throw new NotFoundException("Trip not found");
                }
                if (Date.parse(trip.departureAt) <= Date.now()) {
                    throw new ConflictException("Tickets cannot be purchased after departure");
                }
                if (trip.occupiedSeats >= trip.capacity) {
                    throw new ConflictException("No seats are available");
                }
                if (await this.repository.findActiveTicket(passenger.id, tripId, executor)) {
                    throw new ConflictException("An active ticket for this trip already exists");
                }

                const ticket: Ticket = {
                    id: randomUUID(),
                    passengerId: passenger.id,
                    tripId,
                    price: trip.price,
                    status: "ACTIVE",
                    purchasedAt: new Date().toISOString(),
                    cancelledAt: null,
                };
                await this.repository.createTicket(ticket, executor);
                await this.repository.adjustOccupiedSeats(tripId, 1, executor);
                const result = await this.repository.findTicketWithTrip(ticket.id, executor);
                if (!result) {
                    throw new Error("Purchased ticket was not found inside its transaction");
                }
                this.logger.log("ticket.purchased", {
                    ticketId: ticket.id,
                    tripId,
                    passengerId: passenger.id,
                });
                return { value: result, statusCode: 201 };
            },
        );
    }

    listMine(user: User, query: TicketQueryDto) {
        return this.repository.listTickets(user.id, query);
    }

    async findById(id: string, user: User) {
        const ticket = await this.repository.findTicketWithTrip(id);
        if (!ticket) {
            throw new NotFoundException("Ticket not found");
        }
        if (user.role !== "ADMIN" && ticket.passengerId !== user.id) {
            throw new ForbiddenException("Ticket belongs to another user");
        }
        return ticket;
    }

    async cancel(id: string, user: User, key: string | undefined) {
        const initialTicket = await this.repository.findTicket(id);
        if (!initialTicket) {
            throw new NotFoundException("Ticket not found");
        }
        if (initialTicket.passengerId !== user.id) {
            throw new ForbiddenException("Ticket belongs to another user");
        }

        return executeIdempotently(
            this.idempotencyStore,
            user.id,
            `ticket.cancel:${id}`,
            key,
            { id },
            async (executor) => {
                const trip = await this.repository.findTripForUpdate(
                    initialTicket.tripId,
                    executor,
                );
                if (!trip) {
                    throw new NotFoundException("Trip not found");
                }
                const ticket = await this.repository.findTicketForUpdate(id, executor);
                if (!ticket) {
                    throw new NotFoundException("Ticket not found");
                }
                if (ticket.passengerId !== user.id) {
                    throw new ForbiddenException("Ticket belongs to another user");
                }
                if (ticket.status !== "ACTIVE") {
                    throw new ConflictException("Ticket is already cancelled");
                }
                if (Date.parse(trip.departureAt) <= Date.now()) {
                    throw new ConflictException("Tickets cannot be cancelled after departure");
                }

                const cancelledAt = new Date().toISOString();
                await this.repository.cancelTicket(id, cancelledAt, executor);
                await this.repository.adjustOccupiedSeats(ticket.tripId, -1, executor);
                const result = await this.repository.findTicketWithTrip(id, executor);
                if (!result) {
                    throw new Error("Cancelled ticket was not found inside its transaction");
                }
                this.logger.log("ticket.cancelled", {
                    ticketId: id,
                    tripId: ticket.tripId,
                    passengerId: user.id,
                });
                return { value: result, statusCode: 200 };
            },
        );
    }
}
