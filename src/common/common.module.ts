import { Global, Module, RequestMethod } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { InMemoryDatabase } from "./in-memory-database.js";
import { HttpExceptionFilter } from "./http-exception.filter.js";
import { RequestContextMiddleware } from "./request-context.middleware.js";
import { RequestContextService } from "./request-context.service.js";
import { StructuredLogger } from "./structured-logger.js";
import { InMemoryIdempotencyStore } from "./in-memory-idempotency.store.js";
import { IDEMPOTENCY_STORE } from "./idempotency.js";

@Global()
@Module({
    providers: [
        InMemoryDatabase,
        InMemoryIdempotencyStore,
        RequestContextService,
        StructuredLogger,
        RequestContextMiddleware,
        {
            provide: APP_FILTER,
            useClass: HttpExceptionFilter,
        },
        { provide: IDEMPOTENCY_STORE, useExisting: InMemoryIdempotencyStore },
    ],
    exports: [InMemoryDatabase, RequestContextService, StructuredLogger, IDEMPOTENCY_STORE],
})
export class CommonModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer
            .apply(RequestContextMiddleware)
            .forRoutes({ path: "*", method: RequestMethod.ALL });
    }
}
