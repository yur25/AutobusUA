import type { CarrierApplication, Session, Ticket, Trip, User } from "./domain.js";
import type { QueryResultRow } from "pg";

type TimestampValue = Date | string;

export interface UserRow extends QueryResultRow {
    id: string;
    full_name: string;
    phone: string;
    password_hash: string;
    role: User["role"];
    created_at: TimestampValue;
}

export interface CarrierApplicationRow extends QueryResultRow {
    id: string;
    applicant_id: string;
    full_name: string;
    phone: string;
    status: CarrierApplication["status"];
    reviewed_by: string | null;
    rejection_reason: string | null;
    created_at: TimestampValue;
    reviewed_at: TimestampValue | null;
}

export interface TripRow extends QueryResultRow {
    id: string;
    carrier_id: string;
    origin: string;
    destination: string;
    departure_at: TimestampValue;
    arrival_at: TimestampValue;
    price: string;
    capacity: number;
    occupied_seats: number;
    created_at: TimestampValue;
}

export interface TicketRow extends QueryResultRow {
    id: string;
    passenger_id: string;
    trip_id: string;
    price: string;
    status: Ticket["status"];
    purchased_at: TimestampValue;
    cancelled_at: TimestampValue | null;
}

export interface JoinedTicketRow extends TicketRow, QueryResultRow {
    trip_origin: string;
    trip_destination: string;
    trip_departure_at: TimestampValue;
    trip_arrival_at: TimestampValue;
    trip_price: string;
    trip_capacity: number;
    trip_occupied_seats: number;
    trip_created_at: TimestampValue;
    trip_carrier_id: string;
}

function iso(value: TimestampValue): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function maybeIso(value: TimestampValue | null): string | null {
    return value === null ? null : iso(value);
}

export function mapUser(row: UserRow): User {
    return {
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        passwordHash: row.password_hash,
        role: row.role,
        createdAt: iso(row.created_at),
    };
}

export function mapCarrierApplication(row: CarrierApplicationRow): CarrierApplication {
    return {
        id: row.id,
        applicantId: row.applicant_id,
        fullName: row.full_name,
        phone: row.phone,
        status: row.status,
        reviewedBy: row.reviewed_by,
        rejectionReason: row.rejection_reason,
        createdAt: iso(row.created_at),
        reviewedAt: maybeIso(row.reviewed_at),
    };
}

export function mapTrip(row: TripRow): Trip {
    return {
        id: row.id,
        carrierId: row.carrier_id,
        origin: row.origin,
        destination: row.destination,
        departureAt: iso(row.departure_at),
        arrivalAt: iso(row.arrival_at),
        price: row.price,
        capacity: row.capacity,
        occupiedSeats: row.occupied_seats,
        createdAt: iso(row.created_at),
    };
}

export function mapTicket(row: TicketRow): Ticket {
    return {
        id: row.id,
        passengerId: row.passenger_id,
        tripId: row.trip_id,
        price: row.price,
        status: row.status,
        purchasedAt: iso(row.purchased_at),
        cancelledAt: maybeIso(row.cancelled_at),
    };
}

export function mapSession(idHash: string, userId: string, expiresAt: TimestampValue): Session {
    return {
        idHash,
        userId,
        expiresAt: new Date(expiresAt).getTime(),
    };
}

export function mapJoinedTicket(row: JoinedTicketRow): Ticket & { trip: Trip } {
    const ticket = mapTicket(row);
    return {
        ...ticket,
        trip: {
            id: row.trip_id,
            carrierId: row.trip_carrier_id,
            origin: row.trip_origin,
            destination: row.trip_destination,
            departureAt: iso(row.trip_departure_at),
            arrivalAt: iso(row.trip_arrival_at),
            price: row.trip_price,
            capacity: row.trip_capacity,
            occupiedSeats: row.trip_occupied_seats,
            createdAt: iso(row.trip_created_at),
        },
    };
}
