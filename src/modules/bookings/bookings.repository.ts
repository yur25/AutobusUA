import { Injectable } from "@nestjs/common";
import { InMemoryDatabase } from "../../common/in-memory-database.js";
import type { Ticket, Trip } from "../../common/domain.js";
import { StructuredLogger } from "../../common/structured-logger.js";

export const BOOKINGS_REPOSITORY = Symbol("BOOKINGS_REPOSITORY");

export interface BookingsRepository {
    withTripLock<T>(tripId: string, operation: () => Promise<T>): Promise<T>;
    findTrip(id: string): Trip | undefined;
    findTicket(id: string): Ticket | undefined;
    findActiveTicket(passengerId: string, tripId: string): Ticket | undefined;
    createTicket(ticket: Ticket): void;
    updateTicket(ticket: Ticket): void;
    listTickets(passengerId: string): Ticket[];
    incrementOccupiedSeats(tripId: string, delta: number): void;
}

@Injectable()
export class InMemoryBookingsRepository implements BookingsRepository {
    constructor(
        private readonly database: InMemoryDatabase,
        private readonly logger: StructuredLogger,
    ) {}

    withTripLock<T>(tripId: string, operation: () => Promise<T>): Promise<T> {
        return this.database.withLock(`trip:${tripId}`, operation);
    }

    findTrip(id: string): Trip | undefined {
        const trip = this.database.trips.get(id);
        this.logger.debug("repository.bookings.find_trip", {
            tripId: id,
            found: Boolean(trip),
        });
        return trip;
    }

    findTicket(id: string): Ticket | undefined {
        const ticket = this.database.tickets.get(id);
        this.logger.debug("repository.bookings.find_ticket", {
            ticketId: id,
            found: Boolean(ticket),
        });
        return ticket;
    }

    findActiveTicket(passengerId: string, tripId: string): Ticket | undefined {
        const ticket = [...this.database.tickets.values()].find(
            (ticket) =>
                ticket.passengerId === passengerId &&
                ticket.tripId === tripId &&
                ticket.status === "ACTIVE",
        );
        this.logger.debug("repository.bookings.find_active_ticket", {
            passengerId,
            tripId,
            found: Boolean(ticket),
        });
        return ticket;
    }

    createTicket(ticket: Ticket): void {
        this.database.tickets.set(ticket.id, ticket);
        this.logger.log("repository.bookings.create_ticket", {
            ticketId: ticket.id,
            created: true,
        });
    }

    updateTicket(ticket: Ticket): void {
        this.database.tickets.set(ticket.id, ticket);
        this.logger.log("repository.bookings.update_ticket", {
            ticketId: ticket.id,
            updated: true,
            status: ticket.status,
        });
    }

    listTickets(passengerId: string): Ticket[] {
        const tickets = [...this.database.tickets.values()].filter(
            (ticket) => ticket.passengerId === passengerId,
        );
        this.logger.debug("repository.bookings.list_tickets", {
            passengerId,
            count: tickets.length,
        });
        return tickets;
    }

    incrementOccupiedSeats(tripId: string, delta: number): void {
        const trip = this.database.trips.get(tripId);
        if (trip) {
            this.database.trips.set(tripId, {
                ...trip,
                occupiedSeats: trip.occupiedSeats + delta,
            });
        }
        this.logger.log("repository.bookings.update_occupied_seats", {
            tripId,
            updated: Boolean(trip),
            delta,
        });
    }
}
