import { Injectable, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { StructuredLogger } from "./structured-logger.js";
import { RequestContextService } from "./request-context.service.js";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
    constructor(
        private readonly requestContext: RequestContextService,
        private readonly logger: StructuredLogger,
    ) {}

    use(request: Request, response: Response, next: NextFunction): void {
        const businessProcessId = randomUUID();
        response.setHeader("X-Business-Process-Id", businessProcessId);
        this.requestContext.run({ businessProcessId }, () => {
            this.logger.log("request.started", {
                method: request.method,
                path: request.originalUrl,
            });
            response.on("finish", () => {
                this.logger.log("request.completed", {
                    method: request.method,
                    path: request.originalUrl,
                    statusCode: response.statusCode,
                });
            });
            next();
        });
    }
}
