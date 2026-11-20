import { Injectable } from "@nestjs/common";
import { DatabaseService, type SqlExecutor } from "../../common/database.service.js";
import type { Trip } from "../../common/domain.js";
import { mapTrip, type TripRow } from "../../common/postgres-mappers.js";
import { createPage, type Page, type PageQuery } from "../../common/pagination.js";
import { StructuredLogger } from "../../common/structured-logger.js";
import type { TripSearchQueryDto } from "./trips.dto.js";

export const TRIPS_REPOSITORY = Symbol("TRIPS_REPOSITORY");

export type TripVisibility =
    { kind: "AVAILABLE" } | { kind: "CARRIER"; carrierId: string } | { kind: "ALL" };

export interface TripsRepository {
    create(trip: Trip, executor: SqlExecutor): Promise<void>;
    findById(id: string): Promise<Trip | undefined>;
    search(query: TripSearchQueryDto, visibility: TripVisibility): Promise<Page<Trip>>;
    listMine(carrierId: string, query: PageQuery): Promise<Page<Trip>>;
}

function offset(query: PageQuery): number {
    return ((query.page ?? 1) - 1) * (query.pageSize ?? 20);
}

@Injectable()
export class PostgresTripsRepository implements TripsRepository {
    constructor(
        private readonly database: DatabaseService,
        private readonly logger: StructuredLogger,
    ) {}

    async create(trip: Trip, executor: SqlExecutor): Promise<void> {
        await executor.query(
            "trips.create",
            `INSERT INTO trip
                (id, carrier_id, origin, destination, departure_at, arrival_at,
                 price, capacity, occupied_seats, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)`,
            [
                trip.id,
                trip.carrierId,
                trip.origin,
                trip.destination,
                trip.departureAt,
                trip.arrivalAt,
                trip.price,
                trip.capacity,
                trip.createdAt,
            ],
        );
        this.logger.log("repository.trips.create", { tripId: trip.id, created: true });
    }

    async findById(id: string): Promise<Trip | undefined> {
        const result = await this.database.query<TripRow>(
            "trips.find_by_id",
            `SELECT id, carrier_id, origin, destination, departure_at, arrival_at,
                    price, capacity, occupied_seats, created_at
             FROM trip WHERE id = $1`,
            [id],
        );
        const trip = result.rows[0] ? mapTrip(result.rows[0]) : undefined;
        this.logger.debug("repository.trips.find_by_id", {
            tripId: id,
            found: Boolean(trip),
        });
        return trip;
    }

    async search(query: TripSearchQueryDto, visibility: TripVisibility): Promise<Page<Trip>> {
        const { where, values } = this.buildWhere(query, visibility);
        const limit = query.pageSize ?? 20;
        const currentOffset = offset(query);
        return this.database.withReadSnapshot("trips.search_page", async (executor) => {
            const countResult = await executor.query<{ total: string }>(
                "trips.count_search",
                `SELECT count(*)::text AS total FROM trip WHERE ${where}`,
                values,
            );
            const pageResult = await executor.query<TripRow>(
                "trips.search",
                `SELECT id, carrier_id, origin, destination, departure_at, arrival_at,
                        price, capacity, occupied_seats, created_at
                 FROM trip WHERE ${where}
                 ORDER BY departure_at ASC, id ASC
                 LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
                [...values, limit, currentOffset],
            );
            const items = pageResult.rows.map(mapTrip);
            const totalItems = Number(countResult.rows[0]?.total ?? 0);
            this.logger.debug("repository.trips.search", {
                count: items.length,
                totalItems,
                visibility: visibility.kind,
            });
            return createPage(items, totalItems, query);
        });
    }

    async listMine(carrierId: string, query: PageQuery): Promise<Page<Trip>> {
        return this.database.withReadSnapshot("trips.mine_page", async (executor) => {
            const countResult = await executor.query<{ total: string }>(
                "trips.count_mine",
                "SELECT count(*)::text AS total FROM trip WHERE carrier_id = $1",
                [carrierId],
            );
            const pageResult = await executor.query<TripRow>(
                "trips.list_mine",
                `SELECT id, carrier_id, origin, destination, departure_at, arrival_at,
                        price, capacity, occupied_seats, created_at
                 FROM trip WHERE carrier_id = $1
                 ORDER BY departure_at ASC, id ASC
                 LIMIT $2 OFFSET $3`,
                [carrierId, query.pageSize ?? 20, offset(query)],
            );
            const items = pageResult.rows.map(mapTrip);
            const totalItems = Number(countResult.rows[0]?.total ?? 0);
            this.logger.debug("repository.trips.list_mine", {
                carrierId,
                count: items.length,
                totalItems,
            });
            return createPage(items, totalItems, query);
        });
    }

    private buildWhere(
        query: TripSearchQueryDto,
        visibility: TripVisibility,
    ): { where: string; values: unknown[] } {
        const conditions: string[] = [];
        const values: unknown[] = [];
        const add = (condition: (parameter: string) => string, value: unknown): void => {
            values.push(value);
            conditions.push(condition(`$${values.length}`));
        };

        if (visibility.kind === "AVAILABLE") {
            conditions.push("departure_at > now()", "occupied_seats < capacity");
        } else if (visibility.kind === "CARRIER") {
            add((parameter) => `carrier_id = ${parameter}`, visibility.carrierId);
        }
        if (query.origin?.trim()) {
            add(
                (parameter) => `position(lower(${parameter}) in lower(origin)) > 0`,
                query.origin.trim(),
            );
        }
        if (query.destination?.trim()) {
            add(
                (parameter) => `position(lower(${parameter}) in lower(destination)) > 0`,
                query.destination.trim(),
            );
        }
        if (query.departureFrom) {
            add((parameter) => `departure_at >= ${parameter}::timestamptz`, query.departureFrom);
        }
        if (query.departureTo) {
            add((parameter) => `departure_at <= ${parameter}::timestamptz`, query.departureTo);
        }
        return { where: conditions.length ? conditions.join(" AND ") : "TRUE", values };
    }
}
