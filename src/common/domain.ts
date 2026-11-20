export type UserRole = "PASSENGER" | "CARRIER" | "ADMIN";
export type ApplicationStatus = "PENDING" | "VERIFIED" | "REJECTED";
export type TicketStatus = "ACTIVE" | "CANCELLED";

export interface User {
    id: string;
    fullName: string;
    phone: string;
    passwordHash: string;
    role: UserRole;
    createdAt: string;
}

export interface CarrierApplication {
    id: string;
    applicantId: string;
    fullName: string;
    phone: string;
    status: ApplicationStatus;
    reviewedBy: string | null;
    rejectionReason: string | null;
    createdAt: string;
    reviewedAt: string | null;
}

export interface Trip {
    id: string;
    carrierId: string;
    origin: string;
    destination: string;
    departureAt: string;
    arrivalAt: string;
    price: string;
    capacity: number;
    occupiedSeats: number;
    createdAt: string;
}

export interface Ticket {
    id: string;
    passengerId: string;
    tripId: string;
    price: string;
    status: TicketStatus;
    purchasedAt: string;
    cancelledAt: string | null;
}

export interface Session {
    idHash: string;
    userId: string;
    expiresAt: number;
}

export interface IdempotencyRecord {
    userId: string;
    operation: string;
    requestHash: string;
    response: unknown;
    statusCode: number;
    expiresAt: number;
}
