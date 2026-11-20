import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BookingsModule } from "./modules/bookings/bookings.module.js";
import { CarriersModule } from "./modules/carriers/carriers.module.js";
import { TripsModule } from "./modules/trips/trips.module.js";
import { CommonModule } from "./common/common.module.js";
import { DatabaseModule } from "./common/database.module.js";

@Module({
    imports: [
        CommonModule,
        DatabaseModule,
        AuthModule,
        CarriersModule,
        TripsModule,
        BookingsModule,
    ],
    controllers: [AppController],
})
export class AppModule {}
