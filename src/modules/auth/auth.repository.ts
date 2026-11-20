import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service.js";
import type { Session, User } from "../../common/domain.js";
import { mapSession, mapUser, type UserRow } from "../../common/postgres-mappers.js";
import { StructuredLogger } from "../../common/structured-logger.js";

export const AUTH_REPOSITORY = Symbol("AUTH_REPOSITORY");

export interface AuthRepository {
    findUserByPhone(phone: string): Promise<User | undefined>;
    findUserById(id: string): Promise<User | undefined>;
    createUser(user: User): Promise<boolean>;
    createSession(session: Session): Promise<void>;
    findSession(idHash: string): Promise<Session | undefined>;
    deleteSession(idHash: string): Promise<void>;
}

interface PgConstraintError {
    code?: string;
    constraint?: string;
}

function isPhoneUniqueViolation(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        "constraint" in error &&
        (error as PgConstraintError).code === "23505" &&
        (error as PgConstraintError).constraint === "app_user_phone_key"
    );
}

@Injectable()
export class PostgresAuthRepository implements AuthRepository {
    constructor(
        private readonly database: DatabaseService,
        private readonly logger: StructuredLogger,
    ) {}

    async findUserByPhone(phone: string): Promise<User | undefined> {
        const result = await this.database.query<UserRow>(
            "auth.find_user_by_phone",
            `SELECT id, full_name, phone, password_hash, role, created_at
             FROM app_user WHERE phone = $1`,
            [phone],
        );
        const user = result.rows[0] ? mapUser(result.rows[0]) : undefined;
        this.logger.debug("repository.auth.find_user_by_phone", { found: Boolean(user) });
        return user;
    }

    async findUserById(id: string): Promise<User | undefined> {
        const result = await this.database.query<UserRow>(
            "auth.find_user_by_id",
            `SELECT id, full_name, phone, password_hash, role, created_at
             FROM app_user WHERE id = $1`,
            [id],
        );
        const user = result.rows[0] ? mapUser(result.rows[0]) : undefined;
        this.logger.debug("repository.auth.find_user_by_id", {
            userId: id,
            found: Boolean(user),
        });
        return user;
    }

    async createUser(user: User): Promise<boolean> {
        try {
            await this.database.query(
                "auth.create_user",
                `INSERT INTO app_user (id, full_name, phone, password_hash, role, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [user.id, user.fullName, user.phone, user.passwordHash, user.role, user.createdAt],
            );
            this.logger.log("repository.auth.create_user", {
                userId: user.id,
                created: true,
            });
            return true;
        } catch (error) {
            if (!isPhoneUniqueViolation(error)) {
                throw error;
            }
            this.logger.log("repository.auth.create_user", {
                userId: user.id,
                created: false,
            });
            return false;
        }
    }

    async createSession(session: Session): Promise<void> {
        await this.database.query(
            "auth.create_session",
            `INSERT INTO user_session (id_hash, user_id, expires_at)
             VALUES ($1, $2, $3)`,
            [session.idHash, session.userId, new Date(session.expiresAt)],
        );
        this.logger.log("repository.auth.create_session", { created: true });
    }

    async findSession(idHash: string): Promise<Session | undefined> {
        const result = await this.database.query<{
            id_hash: string;
            user_id: string;
            expires_at: Date | string;
        }>(
            "auth.find_session",
            `SELECT id_hash, user_id, expires_at
             FROM user_session WHERE id_hash = $1`,
            [idHash],
        );
        const row = result.rows[0];
        const session = row ? mapSession(row.id_hash, row.user_id, row.expires_at) : undefined;
        this.logger.debug("repository.auth.find_session", { found: Boolean(session) });
        return session;
    }

    async deleteSession(idHash: string): Promise<void> {
        const result = await this.database.query(
            "auth.delete_session",
            "DELETE FROM user_session WHERE id_hash = $1",
            [idHash],
        );
        this.logger.log("repository.auth.delete_session", {
            deleted: result.rowCount > 0,
        });
    }
}
