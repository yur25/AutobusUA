import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TRIPS_REPOSITORY, PostgresTripsRepository } from "./trips.repository.js";
import { TripsController } from "./trips.controller.js";
import { TripsService } from "./trips.service.js";
import { DatabaseModule } from "../../common/database.module.js";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [TripsController],
    providers: [
        TripsService,
        PostgresTripsRepository,
        { provide: TRIPS_REPOSITORY, useExisting: PostgresTripsRepository },
    ],
})
export class TripsModule {}
