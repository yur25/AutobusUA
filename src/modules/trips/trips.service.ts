import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
    executeIdempotently,
    IDEMPOTENCY_STORE,
    type IdempotencyStore,
} from "../../common/idempotency.js";
import { StructuredLogger } from "../../common/structured-logger.js";
import type { Trip, User } from "../../common/domain.js";
import { TRIPS_REPOSITORY, type TripsRepository } from "./trips.repository.js";
import type { CreateTripDto, TripSearchQueryDto } from "./trips.dto.js";

@Injectable()
export class TripsService {
    constructor(
        @Inject(TRIPS_REPOSITORY) private readonly repository: TripsRepository,
        @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyStore,
        private readonly logger: StructuredLogger,
    ) {}

    async create(carrier: User, dto: CreateTripDto, key: string | undefined) {
        const departureAt = new Date(dto.departureAt);
        const arrivalAt = new Date(dto.arrivalAt);
        if (
            !Number.isFinite(departureAt.getTime()) ||
            !Number.isFinite(arrivalAt.getTime()) ||
            departureAt.getTime() <= Date.now() ||
            arrivalAt.getTime() <= departureAt.getTime()
        ) {
            throw new BadRequestException(
                "Trip must have a future departure and an arrival after departure",
            );
        }

        const origin = dto.origin.trim();
        const destination = dto.destination.trim();
        const [integerPart, fractionPart = ""] = dto.price.split(".");
        if (!integerPart) {
            throw new BadRequestException("Trip price must be greater than zero");
        }
        if (origin.length < 2 || destination.length < 2) {
            throw new BadRequestException("Trip origin and destination must not be empty");
        }
        if (!Number.isFinite(Number(dto.price)) || Number(dto.price) <= 0) {
            throw new BadRequestException("Trip price must be greater than zero");
        }
        if (origin.toLowerCase() === destination.toLowerCase()) {
            throw new BadRequestException("Trip origin and destination must differ");
        }

        return executeIdempotently(
            this.idempotencyStore,
            carrier.id,
            "trip.create",
            key,
            dto,
            async (executor) => {
                const trip: Trip = {
                    id: randomUUID(),
                    carrierId: carrier.id,
                    origin,
                    destination,
                    departureAt: departureAt.toISOString(),
                    arrivalAt: arrivalAt.toISOString(),
                    price: `${integerPart.replace(/^0+(?=\d)/, "")}.${fractionPart.padEnd(2, "0")}`,
                    capacity: dto.capacity,
                    occupiedSeats: 0,
                    createdAt: new Date().toISOString(),
                };
                await this.repository.create(trip, executor);
                this.logger.log("trip.created", {
                    tripId: trip.id,
                    carrierId: carrier.id,
                });
                return { value: trip, statusCode: 201 };
            },
        );
    }

    search(query: TripSearchQueryDto, user?: User) {
        const from = query.departureFrom ? Date.parse(query.departureFrom) : undefined;
        const to = query.departureTo ? Date.parse(query.departureTo) : undefined;
        if (from !== undefined && to !== undefined && from > to) {
            throw new BadRequestException("departureFrom must not be after departureTo");
        }

        const visibility =
            user?.role === "ADMIN"
                ? { kind: "ALL" as const }
                : user?.role === "CARRIER"
                  ? { kind: "CARRIER" as const, carrierId: user.id }
                  : { kind: "AVAILABLE" as const };
        return this.repository.search(query, visibility);
    }

    async findById(id: string, user?: User): Promise<Trip> {
        const trip = await this.repository.findById(id);
        if (!trip) {
            throw new NotFoundException("Trip not found");
        }
        const visible =
            user?.role === "ADMIN" ||
            (user?.role === "CARRIER" && trip.carrierId === user.id) ||
            (Date.parse(trip.departureAt) > Date.now() && trip.occupiedSeats < trip.capacity);
        if (!visible) {
            throw new NotFoundException("Trip not found");
        }
        return trip;
    }

    listMine(carrier: User, query: TripSearchQueryDto) {
        return this.repository.listMine(carrier.id, query);
    }
}
