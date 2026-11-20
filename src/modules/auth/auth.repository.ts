import { Injectable } from "@nestjs/common";
import { InMemoryDatabase } from "../../common/in-memory-database.js";
import type { Session, User } from "../../common/domain.js";
import { StructuredLogger } from "../../common/structured-logger.js";
export const AUTH_REPOSITORY = Symbol("AUTH_REPOSITORY");

export interface AuthRepository {
    findUserByPhone(phone: string): User | undefined;
    findUserById(id: string): User | undefined;
    createUser(user: User): Promise<boolean>;
    createSession(session: Session): void;
    findSession(idHash: string): Session | undefined;
    deleteSession(idHash: string): void;
}

@Injectable()
export class InMemoryAuthRepository implements AuthRepository {
    constructor(
        private readonly database: InMemoryDatabase,
        private readonly logger: StructuredLogger,
    ) {}

    findUserByPhone(phone: string): User | undefined {
        const id = this.database.usersByPhone.get(phone);
        const user = id ? this.database.users.get(id) : undefined;
        this.logger.debug("repository.auth.find_user_by_phone", { found: Boolean(user) });
        return user;
    }

    findUserById(id: string): User | undefined {
        const user = this.database.users.get(id);
        this.logger.debug("repository.auth.find_user_by_id", {
            userId: id,
            found: Boolean(user),
        });
        return user;
    }

    createUser(user: User): Promise<boolean> {
        return this.database.withLock(`user-phone:${user.phone}`, async () => {
            if (this.database.usersByPhone.has(user.phone)) {
                this.logger.log("repository.auth.create_user", {
                    userId: user.id,
                    created: false,
                });
                return false;
            }
            this.database.users.set(user.id, user);
            this.database.usersByPhone.set(user.phone, user.id);
            this.logger.log("repository.auth.create_user", {
                userId: user.id,
                created: true,
            });
            return true;
        });
    }

    createSession(session: Session): void {
        this.database.sessions.set(session.idHash, session);
        this.logger.log("repository.auth.create_session", { created: true });
    }

    findSession(idHash: string): Session | undefined {
        const session = this.database.sessions.get(idHash);
        this.logger.debug("repository.auth.find_session", { found: Boolean(session) });
        return session;
    }

    deleteSession(idHash: string): void {
        const deleted = this.database.sessions.has(idHash);
        this.database.sessions.delete(idHash);
        this.logger.log("repository.auth.delete_session", { deleted });
    }
}
