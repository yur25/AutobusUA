import { ConflictException, Injectable } from "@nestjs/common";
import { DatabaseService, type SqlExecutor } from "../../common/database.service.js";
import type { Ticket, Trip } from "../../common/domain.js";
import {
    mapJoinedTicket,
    mapTicket,
    mapTrip,
    type JoinedTicketRow,
    type TicketRow,
    type TripRow,
} from "../../common/postgres-mappers.js";
import { createPage, type Page } from "../../common/pagination.js";
import { StructuredLogger } from "../../common/structured-logger.js";
import type { TicketQueryDto } from "./bookings.dto.js";

export const BOOKINGS_REPOSITORY = Symbol("BOOKINGS_REPOSITORY");

export type TicketWithTrip = Ticket & { trip: Trip };

export interface BookingsRepository {
    findTripForUpdate(id: string, executor: SqlExecutor): Promise<Trip | undefined>;
    findTicket(id: string): Promise<Ticket | undefined>;
    findTicketForUpdate(id: string, executor: SqlExecutor): Promise<Ticket | undefined>;
    findTicketWithTrip(id: string, executor?: SqlExecutor): Promise<TicketWithTrip | undefined>;
    findActiveTicket(
        passengerId: string,
        tripId: string,
        executor: SqlExecutor,
    ): Promise<Ticket | undefined>;
    createTicket(ticket: Ticket, executor: SqlExecutor): Promise<void>;
    cancelTicket(id: string, cancelledAt: string, executor: SqlExecutor): Promise<void>;
    adjustOccupiedSeats(tripId: string, delta: number, executor: SqlExecutor): Promise<void>;
    listTickets(passengerId: string, query: TicketQueryDto): Promise<Page<TicketWithTrip>>;
}

interface PgConstraintError {
    code?: string;
    constraint?: string;
}

function isActiveTicketUniqueViolation(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        "constraint" in error &&
        (error as PgConstraintError).code === "23505" &&
        (error as PgConstraintError).constraint === "ticket_one_active_per_passenger_trip"
    );
}

function offset(query: TicketQueryDto): number {
    return ((query.page ?? 1) - 1) * (query.pageSize ?? 20);
}

const JOINED_TICKET_COLUMNS = `
    t.id, t.passenger_id, t.trip_id, t.price, t.status, t.purchased_at, t.cancelled_at,
    tr.carrier_id AS trip_carrier_id,
    tr.origin AS trip_origin,
    tr.destination AS trip_destination,
    tr.departure_at AS trip_departure_at,
    tr.arrival_at AS trip_arrival_at,
    tr.price AS trip_price,
    tr.capacity AS trip_capacity,
    tr.occupied_seats AS trip_occupied_seats,
    tr.created_at AS trip_created_at`;

@Injectable()
export class PostgresBookingsRepository implements BookingsRepository {
    constructor(
        private readonly database: DatabaseService,
        private readonly logger: StructuredLogger,
    ) {}

    async findTripForUpdate(id: string, executor: SqlExecutor): Promise<Trip | undefined> {
        const result = await executor.query<TripRow>(
            "bookings.lock_trip",
            `SELECT id, carrier_id, origin, destination, departure_at, arrival_at,
                    price, capacity, occupied_seats, created_at
             FROM trip WHERE id = $1 FOR UPDATE`,
            [id],
        );
        const trip = result.rows[0] ? mapTrip(result.rows[0]) : undefined;
        this.logger.debug("repository.bookings.lock_trip", {
            tripId: id,
            found: Boolean(trip),
        });
        return trip;
    }

    async findTicket(id: string): Promise<Ticket | undefined> {
        const result = await this.database.query<TicketRow>(
            "bookings.find_ticket",
            `SELECT id, passenger_id, trip_id, price, status, purchased_at, cancelled_at
             FROM ticket WHERE id = $1`,
            [id],
        );
        return result.rows[0] ? mapTicket(result.rows[0]) : undefined;
    }

    async findTicketForUpdate(id: string, executor: SqlExecutor): Promise<Ticket | undefined> {
        const result = await executor.query<TicketRow>(
            "bookings.lock_ticket",
            `SELECT id, passenger_id, trip_id, price, status, purchased_at, cancelled_at
             FROM ticket WHERE id = $1 FOR UPDATE`,
            [id],
        );
        return result.rows[0] ? mapTicket(result.rows[0]) : undefined;
    }

    async findTicketWithTrip(
        id: string,
        executor?: SqlExecutor,
    ): Promise<TicketWithTrip | undefined> {
        const query = executor ?? this.database;
        const result = await query.query<JoinedTicketRow>(
            "bookings.find_ticket_with_trip",
            `SELECT ${JOINED_TICKET_COLUMNS}
             FROM ticket t
             JOIN trip tr ON tr.id = t.trip_id
             WHERE t.id = $1`,
            [id],
        );
        return result.rows[0] ? mapJoinedTicket(result.rows[0]) : undefined;
    }

    async findActiveTicket(
        passengerId: string,
        tripId: string,
        executor: SqlExecutor,
    ): Promise<Ticket | undefined> {
        const result = await executor.query<TicketRow>(
            "bookings.find_active_ticket",
            `SELECT id, passenger_id, trip_id, price, status, purchased_at, cancelled_at
             FROM ticket
             WHERE passenger_id = $1 AND trip_id = $2 AND status = 'ACTIVE'`,
            [passengerId, tripId],
        );
        return result.rows[0] ? mapTicket(result.rows[0]) : undefined;
    }

    async createTicket(ticket: Ticket, executor: SqlExecutor): Promise<void> {
        try {
            await executor.query(
                "bookings.create_ticket",
                `INSERT INTO ticket
                    (id, passenger_id, trip_id, price, status, purchased_at)
                 VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
                [ticket.id, ticket.passengerId, ticket.tripId, ticket.price, ticket.purchasedAt],
            );
            this.logger.log("repository.bookings.create_ticket", {
                ticketId: ticket.id,
                created: true,
            });
        } catch (error) {
            if (!isActiveTicketUniqueViolation(error)) {
                throw error;
            }
            throw new ConflictException("An active ticket for this trip already exists");
        }
    }

    async cancelTicket(id: string, cancelledAt: string, executor: SqlExecutor): Promise<void> {
        const result = await executor.query(
            "bookings.cancel_ticket",
            `UPDATE ticket
             SET status = 'CANCELLED', cancelled_at = $2
             WHERE id = $1 AND status = 'ACTIVE'`,
            [id, cancelledAt],
        );
        if (result.rowCount !== 1) {
            throw new ConflictException("Ticket is already cancelled");
        }
        this.logger.log("repository.bookings.cancel_ticket", {
            ticketId: id,
            updated: true,
        });
    }

    async adjustOccupiedSeats(tripId: string, delta: number, executor: SqlExecutor): Promise<void> {
        const result = await executor.query(
            "bookings.adjust_occupied_seats",
            `UPDATE trip
             SET occupied_seats = occupied_seats + $2
             WHERE id = $1
               AND occupied_seats + $2 >= 0
               AND occupied_seats + $2 <= capacity`,
            [tripId, delta],
        );
        if (result.rowCount !== 1) {
            throw new ConflictException("Trip capacity invariant would be violated");
        }
        this.logger.log("repository.bookings.adjust_occupied_seats", {
            tripId,
            delta,
            updated: true,
        });
    }

    async listTickets(passengerId: string, query: TicketQueryDto): Promise<Page<TicketWithTrip>> {
        const status = query.status ?? null;
        const values = [passengerId, status];
        return this.database.withReadSnapshot("bookings.tickets_page", async (executor) => {
            const countResult = await executor.query<{ total: string }>(
                "bookings.count_tickets",
                `SELECT count(*)::text AS total FROM ticket
                 WHERE passenger_id = $1 AND ($2::text IS NULL OR status = $2)`,
                values,
            );
            const pageResult = await executor.query<JoinedTicketRow>(
                "bookings.list_tickets",
                `SELECT ${JOINED_TICKET_COLUMNS}
                 FROM ticket t
                 JOIN trip tr ON tr.id = t.trip_id
                 WHERE t.passenger_id = $1 AND ($2::text IS NULL OR t.status = $2)
                 ORDER BY t.purchased_at DESC, t.id ASC
                 LIMIT $3 OFFSET $4`,
                [...values, query.pageSize ?? 20, offset(query)],
            );
            const items = pageResult.rows.map(mapJoinedTicket);
            const totalItems = Number(countResult.rows[0]?.total ?? 0);
            this.logger.debug("repository.bookings.list_tickets", {
                passengerId,
                count: items.length,
                totalItems,
            });
            return createPage(items, totalItems, query);
        });
    }
}
