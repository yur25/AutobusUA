import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import type { Request } from "express";
import { IS_PUBLIC } from "../../common/auth.decorators.js";
import type { User } from "../../common/domain.js";
import { RequestContextService } from "../../common/request-context.service.js";
import { AUTH_REPOSITORY, type AuthRepository } from "./auth.repository.js";

export type AuthenticatedRequest = Request & { user?: User };

export function getSessionCookie(cookieHeader: string | undefined): string | undefined {
    return cookieHeader
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("autobusua_session="))
        ?.slice("autobusua_session=".length);
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
        private readonly requestContext: RequestContextService,
    ) {}

    canActivate(context: ExecutionContext): boolean {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
            const rawId = getSessionCookie(request.headers.cookie);
            if (rawId) {
                this.attachUser(request, rawId, true);
            }
            return true;
        }

        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const rawId = getSessionCookie(request.headers.cookie);
        if (!rawId) {
            throw new UnauthorizedException("Authentication required");
        }

        this.attachUser(request, rawId, false);
        return true;
    }

    private attachUser(request: AuthenticatedRequest, rawId: string, optional: boolean): void {
        const idHash = createHash("sha256").update(rawId).digest("hex");
        const session = this.authRepository.findSession(idHash);
        if (!session || session.expiresAt <= Date.now()) {
            if (session) {
                this.authRepository.deleteSession(idHash);
            }
            if (!optional) {
                throw new UnauthorizedException("Invalid or expired session");
            }
            return;
        }

        const user = this.authRepository.findUserById(session.userId);
        if (!user) {
            this.authRepository.deleteSession(idHash);
            if (!optional) {
                throw new UnauthorizedException("Invalid or expired session");
            }
            return;
        }

        request.user = user;
        this.requestContext.setUserId(user.id);
    }
}
