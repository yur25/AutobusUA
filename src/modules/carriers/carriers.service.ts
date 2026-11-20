import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
    executeIdempotently,
    IDEMPOTENCY_STORE,
    type IdempotencyStore,
} from "../../common/idempotency.js";
import { paginate } from "../../common/pagination.js";
import { StructuredLogger } from "../../common/structured-logger.js";
import type { ApplicationStatus, CarrierApplication, User } from "../../common/domain.js";
import { CARRIERS_REPOSITORY, type CarriersRepository } from "./carriers.repository.js";
import type { CarrierApplicationQueryDto } from "./carriers.dto.js";

@Injectable()
export class CarriersService {
    constructor(
        @Inject(CARRIERS_REPOSITORY) private readonly repository: CarriersRepository,
        @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyStore,
        private readonly logger: StructuredLogger,
    ) {}

    async apply(user: User, key: string | undefined) {
        if (user.role === "CARRIER") {
            throw new ConflictException("Carrier accounts cannot submit another application");
        }
        return executeIdempotently(
            this.idempotencyStore,
            user.id,
            "carrier-application.create",
            key,
            { fullName: user.fullName, phone: user.phone },
            async () => {
                const application: CarrierApplication = {
                    id: randomUUID(),
                    applicantId: user.id,
                    fullName: user.fullName,
                    phone: user.phone,
                    status: "PENDING",
                    reviewedBy: null,
                    rejectionReason: null,
                    createdAt: new Date().toISOString(),
                    reviewedAt: null,
                };
                const created = await this.repository.createApplication(application);
                if (!created) {
                    throw new ConflictException("A pending carrier application already exists");
                }
                this.logger.log("carrier_application.created", {
                    applicationId: application.id,
                    applicantId: user.id,
                });
                return { value: application, statusCode: 201 };
            },
        );
    }

    listMine(user: User, query: CarrierApplicationQueryDto) {
        return paginate(this.sort(this.repository.findApplicationsByApplicant(user.id)), query);
    }

    listAll(query: CarrierApplicationQueryDto, status?: ApplicationStatus) {
        return paginate(this.sort(this.repository.listApplications(status)), query);
    }

    async review(
        id: string,
        admin: User,
        status: "VERIFIED" | "REJECTED",
        key: string | undefined,
        reason?: string,
    ) {
        const existing = this.repository.findApplication(id);
        if (!existing) {
            throw new NotFoundException("Carrier application not found");
        }
        return executeIdempotently(
            this.idempotencyStore,
            admin.id,
            `carrier-application.${status.toLowerCase()}`,
            key,
            { id, reason: reason ?? null },
            async () => {
                const application = await this.repository.reviewApplication(
                    id,
                    admin.id,
                    status,
                    reason,
                );
                if (!application) {
                    throw new ConflictException("Carrier application is no longer pending");
                }
                this.logger.log("carrier_application.reviewed", {
                    applicationId: id,
                    reviewerId: admin.id,
                    status,
                });
                return { value: application, statusCode: 200 };
            },
        );
    }

    private sort(applications: CarrierApplication[]): CarrierApplication[] {
        return applications.sort(
            (left, right) =>
                right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
        );
    }
}
