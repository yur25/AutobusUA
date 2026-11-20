import { Injectable } from "@nestjs/common";
import { InMemoryDatabase } from "../../common/in-memory-database.js";
import type { ApplicationStatus, CarrierApplication } from "../../common/domain.js";
import { StructuredLogger } from "../../common/structured-logger.js";

export const CARRIERS_REPOSITORY = Symbol("CARRIERS_REPOSITORY");

export interface CarriersRepository {
    createApplication(application: CarrierApplication): Promise<boolean>;
    findApplicationsByApplicant(userId: string): CarrierApplication[];
    listApplications(status?: ApplicationStatus): CarrierApplication[];
    findApplication(id: string): CarrierApplication | undefined;
    reviewApplication(
        id: string,
        reviewerId: string,
        status: "VERIFIED" | "REJECTED",
        reason?: string,
    ): Promise<CarrierApplication | undefined>;
}

@Injectable()
export class InMemoryCarriersRepository implements CarriersRepository {
    constructor(
        private readonly database: InMemoryDatabase,
        private readonly logger: StructuredLogger,
    ) {}

    createApplication(application: CarrierApplication): Promise<boolean> {
        return this.database.withLock(
            `pending-application:${application.applicantId}`,
            async () => {
                const hasPending = [...this.database.applications.values()].some(
                    (item) =>
                        item.applicantId === application.applicantId && item.status === "PENDING",
                );
                if (hasPending) {
                    this.logger.log("repository.carriers.create_application", {
                        applicationId: application.id,
                        created: false,
                    });
                    return false;
                }
                this.database.applications.set(application.id, application);
                this.logger.log("repository.carriers.create_application", {
                    applicationId: application.id,
                    created: true,
                });
                return true;
            },
        );
    }

    findApplicationsByApplicant(userId: string): CarrierApplication[] {
        const applications = [...this.database.applications.values()].filter(
            (item) => item.applicantId === userId,
        );
        this.logger.debug("repository.carriers.list_applications_by_applicant", {
            applicantId: userId,
            count: applications.length,
        });
        return applications;
    }

    listApplications(status?: ApplicationStatus): CarrierApplication[] {
        const applications = [...this.database.applications.values()].filter(
            (item) => !status || item.status === status,
        );
        this.logger.debug("repository.carriers.list_applications", {
            status: status ?? null,
            count: applications.length,
        });
        return applications;
    }

    findApplication(id: string): CarrierApplication | undefined {
        const application = this.database.applications.get(id);
        this.logger.debug("repository.carriers.find_application", {
            applicationId: id,
            found: Boolean(application),
        });
        return application;
    }

    reviewApplication(
        id: string,
        reviewerId: string,
        status: "VERIFIED" | "REJECTED",
        reason?: string,
    ): Promise<CarrierApplication | undefined> {
        return this.database.withLock(`carrier-application:${id}`, async () => {
            const application = this.database.applications.get(id);
            if (!application || application.status !== "PENDING") {
                this.logger.log("repository.carriers.review_application", {
                    applicationId: id,
                    reviewed: false,
                });
                return undefined;
            }
            const applicant = this.database.users.get(application.applicantId);
            if (status === "VERIFIED") {
                if (!applicant || applicant.role !== "PASSENGER") {
                    this.logger.warn("repository.carriers.review_application.invalid_applicant", {
                        applicationId: id,
                    });
                    return undefined;
                }
                this.database.users.set(applicant.id, { ...applicant, role: "CARRIER" });
            }
            const updated: CarrierApplication = {
                ...application,
                status,
                reviewedBy: reviewerId,
                rejectionReason: status === "REJECTED" ? (reason ?? null) : null,
                reviewedAt: new Date().toISOString(),
            };
            this.database.applications.set(id, updated);
            this.logger.log("repository.carriers.review_application", {
                applicationId: id,
                reviewed: true,
                status,
            });
            return updated;
        });
    }
}
