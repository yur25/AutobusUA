import { ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SqlExecutor } from "../../common/database.service.js";
import type { ApplicationStatus, CarrierApplication, User, UserRole } from "../../common/domain.js";
import type { IdempotencyStore } from "../../common/idempotency.js";
import { RequestContextService } from "../../common/request-context.service.js";
import { StructuredLogger } from "../../common/structured-logger.js";
import type { Page, PageQuery } from "../../common/pagination.js";
import type { CarriersRepository } from "./carriers.repository.js";
import { CarriersService } from "./carriers.service.js";

const fakeExecutor: SqlExecutor = {
    async query() {
        return { rows: [], rowCount: 0 };
    },
};

class FakeCarriersRepository implements CarriersRepository {
    createApplicationResult = true;
    reviewApplicationResult = true;
    applications: CarrierApplication[] = [];
    readonly created: CarrierApplication[] = [];
    readonly createExecutors: SqlExecutor[] = [];
    readonly applicantQueries: Array<{ userId: string; query: PageQuery }> = [];
    readonly listQueries: Array<{
        status: ApplicationStatus | undefined;
        query: PageQuery;
    }> = [];
    readonly reviews: Array<{
        id: string;
        reviewerId: string;
        status: "VERIFIED" | "REJECTED";
        reason: string | undefined;
        executor: SqlExecutor;
    }> = [];
    findApplicationCalls: string[] = [];

    constructor(application: CarrierApplication = createApplication()) {
        this.applications = [application];
    }

    async createApplication(
        application: CarrierApplication,
        executor: SqlExecutor,
    ): Promise<boolean> {
        this.created.push(application);
        this.createExecutors.push(executor);
        return this.createApplicationResult;
    }

    async findApplicationsByApplicant(
        userId: string,
        query: PageQuery,
    ): Promise<Page<CarrierApplication>> {
        this.applicantQueries.push({ userId, query });
        return makePage(this.applications, query);
    }

    async listApplications(
        status: ApplicationStatus | undefined,
        query: PageQuery,
    ): Promise<Page<CarrierApplication>> {
        this.listQueries.push({ status, query });
        const items = status
            ? this.applications.filter((item) => item.status === status)
            : this.applications;
        return makePage(items, query);
    }

    async findApplication(id: string): Promise<CarrierApplication | undefined> {
        this.findApplicationCalls.push(id);
        return this.applications.find((application) => application.id === id);
    }

    async reviewApplication(
        id: string,
        reviewerId: string,
        status: "VERIFIED" | "REJECTED",
        reason: string | undefined,
        executor: SqlExecutor,
    ): Promise<CarrierApplication | undefined> {
        this.reviews.push({ id, reviewerId, status, reason, executor });
        const application = this.applications.find((item) => item.id === id);
        if (!this.reviewApplicationResult || !application) {
            return undefined;
        }
        return {
            ...application,
            status,
            reviewedBy: reviewerId,
            rejectionReason: status === "REJECTED" ? (reason ?? null) : null,
            reviewedAt: new Date().toISOString(),
        };
    }
}

class FakeIdempotencyStore implements IdempotencyStore {
    readonly calls: Array<{
        userId: string;
        operation: string;
        keyHash: string;
        requestHash: string;
    }> = [];
    private readonly results = new Map<
        string,
        { requestHash: string; result: { value: unknown; statusCode: number } }
    >();

    async executeIdempotently<T>(
        userId: string,
        operation: string,
        keyHash: string,
        requestHash: string,
        action: (executor: SqlExecutor) => Promise<{ value: T; statusCode: number }>,
    ): Promise<{ value: T; statusCode: number; replayed: boolean }> {
        this.calls.push({ userId, operation, keyHash, requestHash });
        const identity = `${userId}:${operation}:${keyHash}`;
        const previous = this.results.get(identity);
        if (previous) {
            if (previous.requestHash !== requestHash) {
                throw new ConflictException("Idempotency key was reused with a different payload");
            }
            return {
                value: previous.result.value as T,
                statusCode: previous.result.statusCode,
                replayed: true,
            };
        }
        const result = await action(fakeExecutor);
        this.results.set(identity, { requestHash, result });
        return { ...result, replayed: false };
    }
}

class FakeLogger extends StructuredLogger {
    readonly messages: string[] = [];

    constructor() {
        super(new RequestContextService());
    }

    override log(message: string): void {
        this.messages.push(message);
    }
}

function makePage(items: CarrierApplication[], query: PageQuery): Page<CarrierApplication> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return {
        items,
        page,
        pageSize,
        totalItems: items.length,
        totalPages: Math.ceil(items.length / pageSize),
    };
}

function createApplication(): CarrierApplication {
    return {
        id: randomUUID(),
        applicantId: randomUUID(),
        fullName: "Test Passenger",
        phone: "+380501234567",
        status: "PENDING",
        reviewedBy: null,
        rejectionReason: null,
        createdAt: new Date().toISOString(),
        reviewedAt: null,
    };
}

function createUser(role: UserRole = "PASSENGER"): User {
    return {
        id: randomUUID(),
        fullName: "Test User",
        phone: "+380501234567",
        passwordHash: "unused-test-hash",
        role,
        createdAt: new Date().toISOString(),
    };
}

function setup(repository = new FakeCarriersRepository()) {
    const idempotencyStore = new FakeIdempotencyStore();
    const logger = new FakeLogger();
    return {
        repository,
        idempotencyStore,
        logger,
        service: new CarriersService(repository, idempotencyStore, logger),
    };
}

describe("CarriersService", () => {
    it("creates an application through the idempotency store", async () => {
        const user = createUser();
        const { service, repository, idempotencyStore, logger } = setup();

        const result = await service.apply(user, "apply-key-0001");

        expect(result).toMatchObject({
            statusCode: 201,
            value: {
                applicantId: user.id,
                fullName: user.fullName,
                phone: user.phone,
                status: "PENDING",
            },
        });
        expect(repository.created).toHaveLength(1);
        expect(repository.created[0]?.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
        expect(repository.createExecutors[0]).toBe(fakeExecutor);
        expect(idempotencyStore.calls[0]).toMatchObject({
            userId: user.id,
            operation: "carrier-application.create",
        });
        expect(logger.messages).toContain("carrier_application.created");
    });

    it("replays an application response for the same idempotency payload", async () => {
        const { service, repository } = setup();
        const user = createUser();

        const first = await service.apply(user, "apply-key-0006");
        const replay = await service.apply(user, "apply-key-0006");

        expect(replay).toMatchObject({
            statusCode: 201,
            value: first.value,
            replayed: true,
        });
        expect(repository.created).toHaveLength(1);
    });

    it("does not allow a carrier to apply again", async () => {
        const { service, repository, idempotencyStore } = setup();

        await expect(service.apply(createUser("CARRIER"), "apply-key-0002")).rejects.toBeInstanceOf(
            ConflictException,
        );

        expect(repository.created).toHaveLength(0);
        expect(idempotencyStore.calls).toHaveLength(0);
    });

    it("reports an existing pending application as a conflict", async () => {
        const repository = new FakeCarriersRepository();
        repository.createApplicationResult = false;
        const { service, logger } = setup(repository);

        await expect(service.apply(createUser(), "apply-key-0003")).rejects.toBeInstanceOf(
            ConflictException,
        );

        expect(logger.messages).not.toContain("carrier_application.created");
    });

    it("includes applicant data in the idempotency payload", async () => {
        const user = createUser();
        const { service } = setup();
        await service.apply(user, "apply-key-0005");

        await expect(
            service.apply({ ...user, fullName: "Changed Name" }, "apply-key-0005"),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it("delegates applicant and administrator list queries", async () => {
        const user = createUser();
        const query = { page: 2, pageSize: 5 };
        const { service, repository } = setup();

        await service.listMine(user, query);
        await service.listAll(query, "PENDING");
        await service.listAll(query);

        expect(repository.applicantQueries).toEqual([{ userId: user.id, query }]);
        expect(repository.listQueries).toEqual([
            { status: "PENDING", query },
            { status: undefined, query },
        ]);
    });

    it("returns not found before attempting to review a missing application", async () => {
        const repository = new FakeCarriersRepository();
        repository.applications = [];
        const { service, idempotencyStore } = setup(repository);

        await expect(
            service.review(randomUUID(), createUser("ADMIN"), "VERIFIED", "review-key-0001"),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(idempotencyStore.calls).toHaveLength(0);
    });

    it("verifies an application and passes the transaction executor to the repository", async () => {
        const admin = createUser("ADMIN");
        const application = createApplication();
        const repository = new FakeCarriersRepository(application);
        const { service, idempotencyStore, logger } = setup(repository);

        const result = await service.review(application.id, admin, "VERIFIED", "review-key-0002");

        expect(result).toMatchObject({
            statusCode: 200,
            value: { id: application.id, status: "VERIFIED", reviewedBy: admin.id },
        });
        expect(repository.reviews[0]).toMatchObject({
            id: application.id,
            reviewerId: admin.id,
            status: "VERIFIED",
            reason: undefined,
            executor: fakeExecutor,
        });
        expect(idempotencyStore.calls[0]?.operation).toBe("carrier-application.verified");
        expect(logger.messages).toContain("carrier_application.reviewed");
    });

    it("rejects an application with the supplied reason", async () => {
        const admin = createUser("ADMIN");
        const application = createApplication();
        const repository = new FakeCarriersRepository(application);
        const { service, idempotencyStore } = setup(repository);

        const result = await service.review(
            application.id,
            admin,
            "REJECTED",
            "review-key-0003",
            "Incomplete documents",
        );

        expect(result.value).toMatchObject({
            status: "REJECTED",
            rejectionReason: "Incomplete documents",
        });
        expect(repository.reviews[0]?.reason).toBe("Incomplete documents");

        await expect(
            service.review(
                application.id,
                admin,
                "REJECTED",
                "review-key-0003",
                "Different reason",
            ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(idempotencyStore.calls[0]?.requestHash).not.toBe(
            idempotencyStore.calls[1]?.requestHash,
        );
    });

    it("includes the application ID in the review idempotency payload", async () => {
        const admin = createUser("ADMIN");
        const firstApplication = createApplication();
        const secondApplication = createApplication();
        const repository = new FakeCarriersRepository(firstApplication);
        repository.applications.push(secondApplication);
        const { service } = setup(repository);

        await service.review(firstApplication.id, admin, "VERIFIED", "shared-review-key-0001");
        await expect(
            service.review(secondApplication.id, admin, "VERIFIED", "shared-review-key-0001"),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(repository.reviews).toHaveLength(1);
    });

    it("reports a conflict when the application is no longer pending", async () => {
        const application = createApplication();
        const repository = new FakeCarriersRepository(application);
        repository.reviewApplicationResult = false;
        const { service, logger } = setup(repository);

        await expect(
            service.review(application.id, createUser("ADMIN"), "VERIFIED", "review-key-0004"),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(logger.messages).not.toContain("carrier_application.reviewed");
    });
});
