import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CARRIERS_REPOSITORY, InMemoryCarriersRepository } from "./carriers.repository.js";
import { CarriersController } from "./carriers.controller.js";
import { CarriersService } from "./carriers.service.js";

@Module({
    imports: [AuthModule],
    controllers: [CarriersController],
    providers: [
        CarriersService,
        InMemoryCarriersRepository,
        { provide: CARRIERS_REPOSITORY, useExisting: InMemoryCarriersRepository },
    ],
})
export class CarriersModule {}
