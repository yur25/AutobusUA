import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BOOKINGS_REPOSITORY, PostgresBookingsRepository } from "./bookings.repository.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";
import { DatabaseModule } from "../../common/database.module.js";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [BookingsController],
    providers: [
        BookingsService,
        PostgresBookingsRepository,
        { provide: BOOKINGS_REPOSITORY, useExisting: PostgresBookingsRepository },
    ],
})
export class BookingsModule {}
