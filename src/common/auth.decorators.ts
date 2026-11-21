import { createParamDecorator, SetMetadata } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { User, UserRole } from "./domain.js";

export const IS_PUBLIC = "isPublicRoute";
export const REQUIRED_ROLES = "requiredRoles";

export const Public = () => SetMetadata(IS_PUBLIC, true);

export const RequireRoles = (...roles: UserRole[]) => SetMetadata(REQUIRED_ROLES, roles);

export const CurrentUser = createParamDecorator(
    (_data: unknown, context: ExecutionContext): User => {
        const request = context.switchToHttp().getRequest<Request & { user: User }>();
        return request.user;
    },
);
