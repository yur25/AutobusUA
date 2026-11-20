import { Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRED_ROLES } from "../../common/auth.decorators.js";
import type { UserRole } from "../../common/domain.js";
import type { AuthenticatedRequest } from "./session-auth.guard.js";

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(REQUIRED_ROLES, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!requiredRoles?.length) {
            return true;
        }

        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        return Boolean(request.user && requiredRoles.includes(request.user.role));
    }
}
