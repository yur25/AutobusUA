import { Injectable } from "@nestjs/common";
import { InMemoryDatabase } from "../../common/in-memory-database.js";
import type { Trip } from "../../common/domain.js";
import { StructuredLogger } from "../../common/structured-logger.js";

export const TRIPS_REPOSITORY = Symbol("TRIPS_REPOSITORY");

export interface TripsRepository {
    create(trip: Trip): void;
    findById(id: string): Trip | undefined;
    list(): Trip[];
}

@Injectable()
export class InMemoryTripsRepository implements TripsRepository {
    constructor(
        private readonly database: InMemoryDatabase,
        private readonly logger: StructuredLogger,
    ) {}

    create(trip: Trip): void {
        this.database.trips.set(trip.id, trip);
        this.logger.log("repository.trips.create", { tripId: trip.id, created: true });
    }

    findById(id: string): Trip | undefined {
        const trip = this.database.trips.get(id);
        this.logger.debug("repository.trips.find_by_id", {
            tripId: id,
            found: Boolean(trip),
        });
        return trip;
    }

    list(): Trip[] {
        const trips = [...this.database.trips.values()];
        this.logger.debug("repository.trips.list", { count: trips.length });
        return trips;
    }
}
