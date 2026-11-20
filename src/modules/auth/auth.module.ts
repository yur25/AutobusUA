import { Module } from "@nestjs/common";
import { PostgresAuthRepository, AUTH_REPOSITORY } from "./auth.repository.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionAuthGuard } from "./session-auth.guard.js";
import { RolesGuard } from "./roles.guard.js";
import { DatabaseModule } from "../../common/database.module.js";

@Module({
    imports: [DatabaseModule],
    controllers: [AuthController],
    providers: [
        AuthService,
        SessionAuthGuard,
        RolesGuard,
        PostgresAuthRepository,
        { provide: AUTH_REPOSITORY, useExisting: PostgresAuthRepository },
    ],
    exports: [AUTH_REPOSITORY, SessionAuthGuard, RolesGuard],
})
export class AuthModule {}
