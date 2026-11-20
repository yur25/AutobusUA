import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { BOOKINGS_REPOSITORY, InMemoryBookingsRepository } from "./bookings.repository.js";
import { BookingsController } from "./bookings.controller.js";
import { BookingsService } from "./bookings.service.js";

@Module({
    imports: [AuthModule],
    controllers: [BookingsController],
    providers: [
        BookingsService,
        InMemoryBookingsRepository,
        { provide: BOOKINGS_REPOSITORY, useExisting: InMemoryBookingsRepository },
    ],
})
export class BookingsModule {}
