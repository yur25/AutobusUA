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
import { paginate } from "../../common/pagination.js";
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
            async () =>
                this.repository.withTripLock(tripId, async () => {
                    const trip = this.repository.findTrip(tripId);
                    if (!trip) {
                        throw new NotFoundException("Trip not found");
                    }
                    if (Date.parse(trip.departureAt) <= Date.now()) {
                        throw new ConflictException("Tickets cannot be purchased after departure");
                    }
                    if (trip.occupiedSeats >= trip.capacity) {
                        throw new ConflictException("No seats are available");
                    }
                    if (this.repository.findActiveTicket(passenger.id, tripId)) {
                        throw new ConflictException(
                            "An active ticket for this trip already exists",
                        );
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
                    this.repository.createTicket(ticket);
                    this.repository.incrementOccupiedSeats(tripId, 1);
                    this.logger.log("ticket.purchased", {
                        ticketId: ticket.id,
                        tripId,
                        passengerId: passenger.id,
                    });
                    return { value: this.withTrip(ticket), statusCode: 201 };
                }),
        );
    }

    listMine(user: User, query: TicketQueryDto) {
        const tickets = this.repository
            .listTickets(user.id)
            .filter((ticket) => !query.status || ticket.status === query.status);
        tickets.sort(
            (left, right) =>
                right.purchasedAt.localeCompare(left.purchasedAt) ||
                left.id.localeCompare(right.id),
        );
        return paginate(
            tickets.map((ticket) => this.withTrip(ticket)),
            query,
        );
    }

    findById(id: string, user: User) {
        const ticket = this.repository.findTicket(id);
        if (!ticket) {
            throw new NotFoundException("Ticket not found");
        }
        if (user.role !== "ADMIN" && ticket.passengerId !== user.id) {
            throw new ForbiddenException("Ticket belongs to another user");
        }
        return this.withTrip(ticket);
    }

    async cancel(id: string, user: User, key: string | undefined) {
        const initialTicket = this.repository.findTicket(id);
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
            async () =>
                this.repository.withTripLock(initialTicket.tripId, async () => {
                    const ticket = this.repository.findTicket(id);
                    if (!ticket) {
                        throw new NotFoundException("Ticket not found");
                    }
                    if (ticket.passengerId !== user.id) {
                        throw new ForbiddenException("Ticket belongs to another user");
                    }
                    if (ticket.status !== "ACTIVE") {
                        throw new ConflictException("Ticket is already cancelled");
                    }
                    const trip = this.repository.findTrip(ticket.tripId);
                    if (!trip) {
                        throw new NotFoundException("Trip not found");
                    }
                    if (Date.parse(trip.departureAt) <= Date.now()) {
                        throw new ConflictException("Tickets cannot be cancelled after departure");
                    }

                    const cancelled: Ticket = {
                        ...ticket,
                        status: "CANCELLED",
                        cancelledAt: new Date().toISOString(),
                    };
                    this.repository.updateTicket(cancelled);
                    this.repository.incrementOccupiedSeats(ticket.tripId, -1);
                    this.logger.log("ticket.cancelled", {
                        ticketId: id,
                        tripId: ticket.tripId,
                        passengerId: user.id,
                    });
                    return {
                        value: this.withTrip(cancelled),
                        statusCode: 200,
                    };
                }),
        );
    }

    private withTrip(ticket: Ticket) {
        const trip = this.repository.findTrip(ticket.tripId);
        if (!trip) {
            throw new NotFoundException("Trip not found");
        }
        return { ...ticket, trip };
    }
}
