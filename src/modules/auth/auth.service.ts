import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { User } from "../../common/domain.js";
import { StructuredLogger } from "../../common/structured-logger.js";
import { RequestContextService } from "../../common/request-context.service.js";
import { AUTH_REPOSITORY, type AuthRepository } from "./auth.repository.js";
import type { LoginDto, RegisterDto } from "./auth.dto.js";

export interface UserResponse {
    id: string;
    fullName: string;
    phone: string;
    role: User["role"];
    createdAt: string;
}

export interface SessionResult {
    user: UserResponse;
    cookie: string;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function normalizePhone(phone: string): string {
    const compact = phone.replace(/[\s()-]/g, "");
    const normalized = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
    if (!/^\+380\d{9}$/.test(normalized)) {
        throw new BadRequestException("Phone number must be a valid Ukrainian E.164 number");
    }
    return normalized;
}

export function toUserResponse(user: User): UserResponse {
    return {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt,
    };
}

function hashSessionId(sessionId: string): string {
    return createHash("sha256").update(sessionId).digest("hex");
}

function buildCookie(sessionId: string, maxAgeSeconds: number): string {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `autobusua_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

@Injectable()
export class AuthService {
    constructor(
        @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
        private readonly logger: StructuredLogger,
        private readonly requestContext: RequestContextService,
    ) {}

    async onModuleInit(): Promise<void> {
        const phone = process.env.BOOTSTRAP_ADMIN_PHONE;
        const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
        if (!phone && !password) {
            return;
        }
        if (!phone || !password) {
            throw new Error(
                "BOOTSTRAP_ADMIN_PHONE and BOOTSTRAP_ADMIN_PASSWORD must be configured together",
            );
        }
        if (password.length < 12 || password.length > 128) {
            throw new Error("BOOTSTRAP_ADMIN_PASSWORD must contain between 12 and 128 characters");
        }

        const normalizedPhone = normalizePhone(phone);
        const existing = this.authRepository.findUserByPhone(normalizedPhone);
        if (existing) {
            if (existing.role !== "ADMIN") {
                throw new Error("Bootstrap administrator phone belongs to a non-admin account");
            }
            return;
        }

        const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
        const created = await this.authRepository.createUser({
            id: randomUUID(),
            fullName: "Bootstrap administrator",
            phone: normalizedPhone,
            passwordHash,
            role: "ADMIN",
            createdAt: new Date().toISOString(),
        });
        if (!created) {
            const concurrentUser = this.authRepository.findUserByPhone(normalizedPhone);
            if (concurrentUser?.role !== "ADMIN") {
                throw new Error("Bootstrap administrator phone belongs to a non-admin account");
            }
            return;
        }
        this.logger.log("auth.bootstrap_admin.created");
    }

    async register(dto: RegisterDto): Promise<UserResponse> {
        const phone = normalizePhone(dto.phone);
        const fullName = dto.fullName.trim();
        if (fullName.length < 2) {
            throw new BadRequestException("Full name must contain at least 2 characters");
        }

        const user: User = {
            id: randomUUID(),
            fullName,
            phone,
            passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
            role: "PASSENGER",
            createdAt: new Date().toISOString(),
        };
        const created = await this.authRepository.createUser(user);
        if (!created) {
            throw new ConflictException("An account with this phone number already exists");
        }
        this.logger.log("auth.user.registered", { userId: user.id });
        return toUserResponse(user);
    }

    async login(dto: LoginDto): Promise<SessionResult> {
        let phone: string;
        try {
            phone = normalizePhone(dto.phone);
        } catch (error) {
            if (error instanceof BadRequestException) {
                throw new UnauthorizedException("Invalid phone number or password");
            }
            throw error;
        }
        const user = this.authRepository.findUserByPhone(phone);
        const valid = user ? await argon2.verify(user.passwordHash, dto.password) : false;
        if (!user || !valid) {
            throw new UnauthorizedException("Invalid phone number or password");
        }

        const rawSessionId = randomBytes(32).toString("base64url");
        const expiresAt = Date.now() + SESSION_TTL_MS;
        this.authRepository.createSession({
            idHash: hashSessionId(rawSessionId),
            userId: user.id,
            expiresAt,
        });
        this.requestContext.setUserId(user.id);
        this.logger.log("auth.user.logged_in", { userId: user.id });
        return {
            user: toUserResponse(user),
            cookie: buildCookie(rawSessionId, SESSION_TTL_MS / 1000),
        };
    }

    logout(rawSessionId: string): void {
        this.authRepository.deleteSession(hashSessionId(rawSessionId));
        this.logger.log("auth.user.logged_out");
    }

    clearCookie(): string {
        return buildCookie("", 0);
    }
}
