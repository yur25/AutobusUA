import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CARRIERS_REPOSITORY, PostgresCarriersRepository } from "./carriers.repository.js";
import { CarriersController } from "./carriers.controller.js";
import { CarriersService } from "./carriers.service.js";
import { DatabaseModule } from "../../common/database.module.js";

@Module({
    imports: [AuthModule, DatabaseModule],
    controllers: [CarriersController],
    providers: [
        CarriersService,
        PostgresCarriersRepository,
        { provide: CARRIERS_REPOSITORY, useExisting: PostgresCarriersRepository },
    ],
})
export class CarriersModule {}
