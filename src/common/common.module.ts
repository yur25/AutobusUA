import { Global, Module, RequestMethod } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { HttpExceptionFilter } from "./http-exception.filter.js";
import { RequestContextMiddleware } from "./request-context.middleware.js";
import { RequestContextService } from "./request-context.service.js";
import { StructuredLogger } from "./structured-logger.js";

@Global()
@Module({
    providers: [
        RequestContextService,
        StructuredLogger,
        RequestContextMiddleware,
        {
            provide: APP_FILTER,
            useClass: HttpExceptionFilter,
        },
    ],
    exports: [RequestContextService, StructuredLogger],
})
export class CommonModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer
            .apply(RequestContextMiddleware)
            .forRoutes({ path: "*", method: RequestMethod.ALL });
    }
}
