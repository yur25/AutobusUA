import { UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IS_PUBLIC, REQUIRED_ROLES } from "../../common/auth.decorators.js";
import { RequestContextService } from "../../common/request-context.service.js";
import { RolesGuard } from "./roles.guard.js";
import { SessionAuthGuard, getSessionCookie } from "./session-auth.guard.js";
import type { AuthRepository } from "./auth.repository.js";
import { createUser } from "../../../tests/test-helpers.js";

function createContext(
    handler: () => void,
    request: { headers: { cookie?: string }; user?: object },
) {
    return new ExecutionContextHost([request], TestController, handler);
}

function createAuthRepository(overrides: Partial<AuthRepository> = {}): AuthRepository {
    const defaults: AuthRepository = {
        findUserByPhone: vi.fn(async () => undefined),
        findUserById: vi.fn(async () => undefined),
        createUser: vi.fn(async () => true),
        createSession: vi.fn(async () => undefined),
        findSession: vi.fn(async () => undefined),
        deleteSession: vi.fn(async () => undefined),
    };
    return { ...defaults, ...overrides };
}

afterEach(() => {
    Reflect.deleteMetadata(IS_PUBLIC, publicHandler);
    Reflect.deleteMetadata(REQUIRED_ROLES, adminHandler);
    Reflect.deleteMetadata(REQUIRED_ROLES, classRoleHandler);
    Reflect.deleteMetadata(REQUIRED_ROLES, TestController);
});

function publicHandler(): void {}
function adminHandler(): void {}
function classRoleHandler(): void {}
class TestController {}

describe("RolesGuard", () => {
    it("allows routes without role metadata", () => {
        const guard = new RolesGuard(new Reflector());

        expect(guard.canActivate(createContext(publicHandler, { headers: {} }))).toBe(true);
    });

    it("allows only an explicitly required role", () => {
        Reflect.defineMetadata(REQUIRED_ROLES, ["ADMIN"], adminHandler);
        const guard = new RolesGuard(new Reflector());

        expect(
            guard.canActivate(
                createContext(adminHandler, { headers: {}, user: createUser("ADMIN") }),
            ),
        ).toBe(true);
        expect(
            guard.canActivate(
                createContext(adminHandler, { headers: {}, user: createUser("CARRIER") }),
            ),
        ).toBe(false);
        expect(guard.canActivate(createContext(adminHandler, { headers: {} }))).toBe(false);
    });

    it("uses controller roles when the handler has no override", () => {
        Reflect.defineMetadata(REQUIRED_ROLES, ["CARRIER"], TestController);
        const context = createContext(classRoleHandler, {
            headers: {},
            user: createUser("CARRIER"),
        });
        const guard = new RolesGuard(new Reflector());

        expect(guard.canActivate(context)).toBe(true);
    });
});

describe("SessionAuthGuard", () => {
    it("parses only the named session cookie", () => {
        expect(getSessionCookie("theme=dark; autobusua_session=abc123; other=x")).toBe("abc123");
        expect(getSessionCookie("autobusua_session")).toBeUndefined();
        expect(getSessionCookie(undefined)).toBeUndefined();
    });

    it("allows public requests without a session and protects private routes without a cookie", async () => {
        Reflect.defineMetadata(IS_PUBLIC, true, publicHandler);
        const repository = createAuthRepository();
        const guard = new SessionAuthGuard(
            new Reflector(),
            repository,
            new RequestContextService(),
        );

        await expect(
            guard.canActivate(createContext(publicHandler, { headers: {} })),
        ).resolves.toBe(true);
        await expect(
            guard.canActivate(createContext(adminHandler, { headers: {} })),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(repository.findSession).not.toHaveBeenCalled();
    });

    it("deletes expired or orphaned sessions and rejects protected requests", async () => {
        const expiredSession = { idHash: "hash", userId: "user", expiresAt: Date.now() - 1 };
        const repository = createAuthRepository({
            findSession: vi.fn(async () => expiredSession),
        });
        const guard = new SessionAuthGuard(
            new Reflector(),
            repository,
            new RequestContextService(),
        );
        const context = createContext(adminHandler, {
            headers: { cookie: "autobusua_session=expired-token" },
        });

        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
        expect(repository.deleteSession).toHaveBeenCalledOnce();

        const orphanedRepository = createAuthRepository({
            findSession: vi.fn(async () => ({
                idHash: "hash",
                userId: "missing-user",
                expiresAt: Date.now() + 60_000,
            })),
        });
        const orphanedGuard = new SessionAuthGuard(
            new Reflector(),
            orphanedRepository,
            new RequestContextService(),
        );
        await expect(orphanedGuard.canActivate(context)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        expect(orphanedRepository.deleteSession).toHaveBeenCalledOnce();
    });

    it("attaches a valid session user to the request and request context", async () => {
        const user = createUser("PASSENGER");
        const repository = createAuthRepository({
            findSession: vi.fn(async () => ({
                idHash: "hash",
                userId: user.id,
                expiresAt: Date.now() + 60_000,
            })),
            findUserById: vi.fn(async () => user),
        });
        const requestContext = new RequestContextService();
        const setUserId = vi.spyOn(requestContext, "setUserId");
        const guard = new SessionAuthGuard(new Reflector(), repository, requestContext);
        const request: { headers: { cookie?: string }; user?: object } = {
            headers: { cookie: "autobusua_session=valid-token" },
        };

        await expect(guard.canActivate(createContext(adminHandler, request))).resolves.toBe(true);
        expect(request.user).toEqual(user);
        expect(setUserId).toHaveBeenCalledWith(user.id);
    });
});
