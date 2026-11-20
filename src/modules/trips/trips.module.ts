import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TRIPS_REPOSITORY, InMemoryTripsRepository } from "./trips.repository.js";
import { TripsController } from "./trips.controller.js";
import { TripsService } from "./trips.service.js";

@Module({
    imports: [AuthModule],
    controllers: [TripsController],
    providers: [
        TripsService,
        InMemoryTripsRepository,
        { provide: TRIPS_REPOSITORY, useExisting: InMemoryTripsRepository },
    ],
})
export class TripsModule {}
