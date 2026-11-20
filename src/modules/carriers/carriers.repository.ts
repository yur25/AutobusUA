import { Injectable } from "@nestjs/common";
import { DatabaseService, type SqlExecutor } from "../../common/database.service.js";
import type { ApplicationStatus, CarrierApplication } from "../../common/domain.js";
import {
    mapCarrierApplication,
    type CarrierApplicationRow,
} from "../../common/postgres-mappers.js";
import { createPage, type Page, type PageQuery } from "../../common/pagination.js";
import { StructuredLogger } from "../../common/structured-logger.js";

export const CARRIERS_REPOSITORY = Symbol("CARRIERS_REPOSITORY");

export interface CarriersRepository {
    createApplication(application: CarrierApplication, executor: SqlExecutor): Promise<boolean>;
    findApplicationsByApplicant(
        userId: string,
        query: PageQuery,
    ): Promise<Page<CarrierApplication>>;
    listApplications(
        status: ApplicationStatus | undefined,
        query: PageQuery,
    ): Promise<Page<CarrierApplication>>;
    findApplication(id: string): Promise<CarrierApplication | undefined>;
    reviewApplication(
        id: string,
        reviewerId: string,
        status: "VERIFIED" | "REJECTED",
        reason: string | undefined,
        executor: SqlExecutor,
    ): Promise<CarrierApplication | undefined>;
}

interface PgConstraintError {
    code?: string;
    constraint?: string;
}

function isPendingUniqueViolation(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        "constraint" in error &&
        (error as PgConstraintError).code === "23505" &&
        (error as PgConstraintError).constraint === "carrier_application_one_pending_per_user"
    );
}

function offset(query: PageQuery): number {
    return ((query.page ?? 1) - 1) * (query.pageSize ?? 20);
}

@Injectable()
export class PostgresCarriersRepository implements CarriersRepository {
    constructor(
        private readonly database: DatabaseService,
        private readonly logger: StructuredLogger,
    ) {}

    async createApplication(
        application: CarrierApplication,
        executor: SqlExecutor,
    ): Promise<boolean> {
        try {
            await executor.query(
                "carriers.create_application",
                `INSERT INTO carrier_application
                    (id, applicant_id, full_name, phone, status, created_at)
                 VALUES ($1, $2, $3, $4, 'PENDING', $5)`,
                [
                    application.id,
                    application.applicantId,
                    application.fullName,
                    application.phone,
                    application.createdAt,
                ],
            );
            this.logger.log("repository.carriers.create_application", {
                applicationId: application.id,
                created: true,
            });
            return true;
        } catch (error) {
            if (!isPendingUniqueViolation(error)) {
                throw error;
            }
            this.logger.log("repository.carriers.create_application", {
                applicationId: application.id,
                created: false,
            });
            return false;
        }
    }

    async findApplicationsByApplicant(
        userId: string,
        query: PageQuery,
    ): Promise<Page<CarrierApplication>> {
        return this.database.withReadSnapshot("carriers.applicant_page", async (executor) => {
            const countResult = await executor.query<{ total: string }>(
                "carriers.count_applications_by_applicant",
                `SELECT count(*)::text AS total
                 FROM carrier_application WHERE applicant_id = $1`,
                [userId],
            );
            const pageResult = await executor.query<CarrierApplicationRow>(
                "carriers.list_applications_by_applicant",
                `SELECT id, applicant_id, full_name, phone, status, reviewed_by,
                        rejection_reason, created_at, reviewed_at
                 FROM carrier_application
                 WHERE applicant_id = $1
                 ORDER BY created_at DESC, id ASC
                 LIMIT $2 OFFSET $3`,
                [userId, query.pageSize ?? 20, offset(query)],
            );
            const items = pageResult.rows.map(mapCarrierApplication);
            const totalItems = Number(countResult.rows[0]?.total ?? 0);
            this.logger.debug("repository.carriers.list_applications_by_applicant", {
                applicantId: userId,
                count: items.length,
                totalItems,
            });
            return createPage(items, totalItems, query);
        });
    }

    async listApplications(
        status: ApplicationStatus | undefined,
        query: PageQuery,
    ): Promise<Page<CarrierApplication>> {
        return this.database.withReadSnapshot("carriers.applications_page", async (executor) => {
            const countResult = await executor.query<{ total: string }>(
                "carriers.count_applications",
                `SELECT count(*)::text AS total
                 FROM carrier_application
                 WHERE $1::text IS NULL OR status = $1`,
                [status ?? null],
            );
            const pageResult = await executor.query<CarrierApplicationRow>(
                "carriers.list_applications",
                `SELECT id, applicant_id, full_name, phone, status, reviewed_by,
                        rejection_reason, created_at, reviewed_at
                 FROM carrier_application
                 WHERE $1::text IS NULL OR status = $1
                 ORDER BY created_at DESC, id ASC
                 LIMIT $2 OFFSET $3`,
                [status ?? null, query.pageSize ?? 20, offset(query)],
            );
            const items = pageResult.rows.map(mapCarrierApplication);
            const totalItems = Number(countResult.rows[0]?.total ?? 0);
            this.logger.debug("repository.carriers.list_applications", {
                status: status ?? null,
                count: items.length,
                totalItems,
            });
            return createPage(items, totalItems, query);
        });
    }

    async findApplication(id: string): Promise<CarrierApplication | undefined> {
        const result = await this.database.query<CarrierApplicationRow>(
            "carriers.find_application",
            `SELECT id, applicant_id, full_name, phone, status, reviewed_by,
                    rejection_reason, created_at, reviewed_at
             FROM carrier_application WHERE id = $1`,
            [id],
        );
        const application = result.rows[0] ? mapCarrierApplication(result.rows[0]) : undefined;
        this.logger.debug("repository.carriers.find_application", {
            applicationId: id,
            found: Boolean(application),
        });
        return application;
    }

    async reviewApplication(
        id: string,
        reviewerId: string,
        status: "VERIFIED" | "REJECTED",
        reason: string | undefined,
        executor: SqlExecutor,
    ): Promise<CarrierApplication | undefined> {
        const locked = await executor.query<CarrierApplicationRow>(
            "carriers.lock_pending_application",
            `SELECT id, applicant_id, full_name, phone, status, reviewed_by,
                    rejection_reason, created_at, reviewed_at
             FROM carrier_application
             WHERE id = $1 AND status = 'PENDING'
             FOR UPDATE`,
            [id],
        );
        const pending = locked.rows[0];
        if (!pending) {
            this.logger.log("repository.carriers.review_application", {
                applicationId: id,
                reviewed: false,
            });
            return undefined;
        }

        if (status === "VERIFIED") {
            const promoted = await executor.query(
                "carriers.promote_applicant",
                `UPDATE app_user SET role = 'CARRIER'
                 WHERE id = $1 AND role = 'PASSENGER'`,
                [pending.applicant_id],
            );
            if (promoted.rowCount !== 1) {
                return undefined;
            }
        }

        const result = await executor.query<CarrierApplicationRow>(
            "carriers.review_application",
            `UPDATE carrier_application
             SET status = $2, reviewed_by = $3, reviewed_at = now(),
                 rejection_reason = $4
             WHERE id = $1 AND status = 'PENDING'
             RETURNING id, applicant_id, full_name, phone, status, reviewed_by,
                       rejection_reason, created_at, reviewed_at`,
            [id, status, reviewerId, status === "REJECTED" ? (reason ?? null) : null],
        );
        const application = result.rows[0] ? mapCarrierApplication(result.rows[0]) : undefined;
        this.logger.log("repository.carriers.review_application", {
            applicationId: id,
            reviewed: Boolean(application),
            status,
        });
        return application;
    }
}
