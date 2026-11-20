import { Module } from "@nestjs/common";
import { InMemoryAuthRepository, AUTH_REPOSITORY } from "./auth.repository.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionAuthGuard } from "./session-auth.guard.js";
import { RolesGuard } from "./roles.guard.js";

@Module({
    controllers: [AuthController],
    providers: [
        AuthService,
        SessionAuthGuard,
        RolesGuard,
        InMemoryAuthRepository,
        { provide: AUTH_REPOSITORY, useExisting: InMemoryAuthRepository },
    ],
    exports: [AUTH_REPOSITORY, SessionAuthGuard, RolesGuard],
})
export class AuthModule {}
