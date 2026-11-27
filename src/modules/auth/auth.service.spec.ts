import { BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContextService } from "../../common/request-context.service.js";
import type { User } from "../../common/domain.js";
import { AuthService } from "./auth.service.js";
import type { AuthRepository } from "./auth.repository.js";
import { createLogger, createUser } from "../../../tests/test-helpers.js";

vi.mock("argon2", async (importOriginal) => {
    const actual = await importOriginal<typeof import("argon2")>();
    return {
        ...actual,
        hash: vi.fn(async (password: string) => `test-hash:${password}`),
        verify: vi.fn(async (hash: string, password: string) => hash === `test-hash:${password}`),
    };
});

function createRepository(overrides: Partial<AuthRepository> = {}): AuthRepository {
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

function createService(repository: AuthRepository, context = new RequestContextService()) {
    return {
        service: new AuthService(repository, createLogger(), context),
        context,
    };
}

const originalAdminPhone = process.env.BOOTSTRAP_ADMIN_PHONE;
const originalAdminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

beforeEach(() => {
    delete process.env.BOOTSTRAP_ADMIN_PHONE;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
});

afterEach(() => {
    if (originalAdminPhone === undefined) {
        delete process.env.BOOTSTRAP_ADMIN_PHONE;
    } else {
        process.env.BOOTSTRAP_ADMIN_PHONE = originalAdminPhone;
    }
    if (originalAdminPassword === undefined) {
        delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    } else {
        process.env.BOOTSTRAP_ADMIN_PASSWORD = originalAdminPassword;
    }
});

describe("AuthService registration and login", () => {
    it("normalizes phone numbers and rejects values outside the supported format", async () => {
        const { service } = createService(createRepository());

        await expect(
            service.register({
                fullName: "Valid Name",
                phone: "00380 (50) 123-45-67",
                password: "a-secure-password",
            }),
        ).resolves.toMatchObject({ phone: "+380501234567", role: "PASSENGER" });
        expect(argon2.hash).toHaveBeenCalledWith("a-secure-password", {
            type: argon2.argon2id,
        });
        await expect(
            service.register({
                fullName: "Valid Name",
                phone: "+12025550123",
                password: "a-secure-password",
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.register({
                fullName: "Valid Name",
                phone: "+380501234567extra",
                password: "a-secure-password",
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            service.register({
                fullName: "Valid Name",
                phone: "x+380501234567",
                password: "a-secure-password",
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects short trimmed names before hashing or creating an account", async () => {
        const repository = createRepository();
        const { service } = createService(repository);

        await expect(
            service.register({
                fullName: " A ",
                phone: "+380501234567",
                password: "a-secure-password",
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(argon2.hash).not.toHaveBeenCalled();
        expect(repository.createUser).not.toHaveBeenCalled();
    });

    it("accepts a trimmed name at the minimum supported length", async () => {
        const { service } = createService(createRepository());

        await expect(
            service.register({
                fullName: " AB ",
                phone: "+380501234567",
                password: "a-secure-password",
            }),
        ).resolves.toMatchObject({ fullName: "AB" });
    });

    it("reports a duplicate phone number as a conflict", async () => {
        const repository = createRepository({ createUser: vi.fn(async () => false) });
        const { service } = createService(repository);

        await expect(
            service.register({
                fullName: "Valid Name",
                phone: "+380501234567",
                password: "a-secure-password",
            }),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects an unknown account without querying with an invalid phone", async () => {
        const repository = createRepository();
        const { service } = createService(repository);

        await expect(
            service.login({
                phone: "not-a-phone",
                password: "wrong-password",
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(repository.findUserByPhone).not.toHaveBeenCalled();

        await expect(
            service.login({
                phone: "+380501234567",
                password: "wrong-password",
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(repository.createSession).not.toHaveBeenCalled();
    });

    it("does not mask unexpected phone normalization errors", async () => {
        const repository = createRepository();
        const { service } = createService(repository);

        await expect(
            service.login({ phone: null as never, password: "password" }),
        ).rejects.toBeInstanceOf(TypeError);
        expect(repository.findUserByPhone).not.toHaveBeenCalled();
    });

    it("uses the same unauthorized response for a known account with a bad password", async () => {
        const existingUser = createUser("PASSENGER");
        const withUser = createRepository({
            findUserByPhone: vi.fn(async () => ({
                ...existingUser,
                passwordHash: "test-hash:correct-password",
            })),
        });
        const { service: loginService } = createService(withUser);
        await expect(
            loginService.login({
                phone: "+380501234567",
                password: "wrong-password",
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(withUser.createSession).not.toHaveBeenCalled();
    });

    it("creates a hashed session after valid credentials", async () => {
        const user: User = { ...createUser(), passwordHash: "test-hash:correct-password" };
        const repository = createRepository({
            findUserByPhone: vi.fn(async () => user),
        });
        const context = new RequestContextService();
        const setUserId = vi.spyOn(context, "setUserId");
        const { service } = createService(repository, context);

        const result = await service.login({
            phone: user.phone,
            password: "correct-password",
        });

        expect(result.user.id).toBe(user.id);
        expect(result.cookie).toContain("HttpOnly; SameSite=Strict");
        expect(result.cookie).not.toContain("; Secure");
        expect(result.cookie).not.toContain("test-hash");
        expect(repository.createSession).toHaveBeenCalledWith(
            expect.objectContaining({ userId: user.id }),
        );
        const session = vi.mocked(repository.createSession).mock.calls[0]?.[0];
        expect(session?.idHash).toMatch(/^[a-f0-9]{64}$/);
        expect(session?.expiresAt).toBeGreaterThan(Date.now() + 11 * 60 * 60 * 1000);
        expect(result.cookie).toMatch(/Max-Age=43200(?:;|$)/);
        expect(setUserId).toHaveBeenCalledWith(user.id);
    });

    it("sets the Secure flag on session cookies in production", async () => {
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try {
            const user: User = { ...createUser(), passwordHash: "test-hash:correct-password" };
            const repository = createRepository({
                findUserByPhone: vi.fn(async () => user),
            });
            const { service } = createService(repository);

            const result = await service.login({
                phone: user.phone,
                password: "correct-password",
            });

            expect(result.cookie).toContain("; Secure");
        } finally {
            if (previousNodeEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = previousNodeEnv;
            }
        }
    });

    it("hashes the session identifier before deleting a session on logout", async () => {
        const repository = createRepository();
        const { service } = createService(repository);
        const rawSessionId = "session-to-revoke";

        await service.logout(rawSessionId);

        expect(repository.deleteSession).toHaveBeenCalledWith(
            createHash("sha256").update(rawSessionId).digest("hex"),
        );
        expect(repository.deleteSession).not.toHaveBeenCalledWith(rawSessionId);
    });

    it("clears the session cookie with an empty value and zero max age", () => {
        const { service } = createService(createRepository());

        expect(service.clearCookie()).toContain("autobusua_session=; ");
        expect(service.clearCookie()).toContain("Max-Age=0");
    });
});

describe("AuthService bootstrap administrator", () => {
    it("does nothing when both bootstrap credentials are absent", async () => {
        const repository = createRepository();
        const { service } = createService(repository);

        await expect(service.onModuleInit()).resolves.toBeUndefined();
        expect(repository.findUserByPhone).not.toHaveBeenCalled();
    });

    it("fails fast for partial credentials and invalid password length", async () => {
        const repository = createRepository();
        const { service } = createService(repository);
        process.env.BOOTSTRAP_ADMIN_PHONE = "+380501234567";

        await expect(service.onModuleInit()).rejects.toThrow(
            "BOOTSTRAP_ADMIN_PHONE and BOOTSTRAP_ADMIN_PASSWORD must be configured together",
        );

        process.env.BOOTSTRAP_ADMIN_PASSWORD = "short";
        await expect(service.onModuleInit()).rejects.toThrow(
            "BOOTSTRAP_ADMIN_PASSWORD must contain between 12 and 128 characters",
        );
        expect(repository.createUser).not.toHaveBeenCalled();
    });

    it("accepts bootstrap passwords at both supported length boundaries", async () => {
        process.env.BOOTSTRAP_ADMIN_PHONE = "+380501234567";
        const repository = createRepository();
        const { service } = createService(repository);

        process.env.BOOTSTRAP_ADMIN_PASSWORD = "a".repeat(12);
        await expect(service.onModuleInit()).resolves.toBeUndefined();
        expect(repository.createUser).toHaveBeenCalledTimes(1);

        process.env.BOOTSTRAP_ADMIN_PASSWORD = "b".repeat(128);
        await expect(service.onModuleInit()).resolves.toBeUndefined();
        expect(repository.createUser).toHaveBeenCalledTimes(2);

        process.env.BOOTSTRAP_ADMIN_PASSWORD = "c".repeat(129);
        await expect(service.onModuleInit()).rejects.toThrow(
            "BOOTSTRAP_ADMIN_PASSWORD must contain between 12 and 128 characters",
        );
    });

    it("leaves an existing administrator unchanged and rejects a passenger with that phone", async () => {
        process.env.BOOTSTRAP_ADMIN_PHONE = "+380501234567";
        process.env.BOOTSTRAP_ADMIN_PASSWORD = "long-enough-password";
        const adminRepository = createRepository({
            findUserByPhone: vi.fn(async () => createUser("ADMIN")),
        });
        const { service: adminService } = createService(adminRepository);
        await expect(adminService.onModuleInit()).resolves.toBeUndefined();
        expect(adminRepository.createUser).not.toHaveBeenCalled();

        const passengerRepository = createRepository({
            findUserByPhone: vi.fn(async () => createUser("PASSENGER")),
        });
        const { service: passengerService } = createService(passengerRepository);
        await expect(passengerService.onModuleInit()).rejects.toThrow(
            "Bootstrap administrator phone belongs to a non-admin account",
        );
    });

    it("creates an administrator and handles a concurrent same-phone creation", async () => {
        process.env.BOOTSTRAP_ADMIN_PHONE = "+380501234567";
        process.env.BOOTSTRAP_ADMIN_PASSWORD = "long-enough-password";

        const repository = createRepository();
        const { service } = createService(repository);
        await service.onModuleInit();
        expect(argon2.hash).toHaveBeenCalledWith("long-enough-password", {
            type: argon2.argon2id,
        });
        expect(repository.createUser).toHaveBeenCalledWith(
            expect.objectContaining({
                fullName: "Bootstrap administrator",
                role: "ADMIN",
                phone: "+380501234567",
                passwordHash: "test-hash:long-enough-password",
            }),
        );

        const raceRepository = createRepository({
            findUserByPhone: vi
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(createUser("ADMIN")),
            createUser: vi.fn(async () => false),
        });
        const { service: raceService } = createService(raceRepository);
        await expect(raceService.onModuleInit()).resolves.toBeUndefined();
        expect(raceRepository.findUserByPhone).toHaveBeenCalledTimes(2);

        const nonAdminRaceRepository = createRepository({
            findUserByPhone: vi
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(createUser("PASSENGER")),
            createUser: vi.fn(async () => false),
        });
        const { service: nonAdminRaceService } = createService(nonAdminRaceRepository);
        await expect(nonAdminRaceService.onModuleInit()).rejects.toThrow(
            "Bootstrap administrator phone belongs to a non-admin account",
        );

        const missingRaceRepository = createRepository({
            findUserByPhone: vi
                .fn()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(undefined),
            createUser: vi.fn(async () => false),
        });
        const { service: missingRaceService } = createService(missingRaceRepository);
        await expect(missingRaceService.onModuleInit()).rejects.toThrow(
            "Bootstrap administrator phone belongs to a non-admin account",
        );
    });
});
