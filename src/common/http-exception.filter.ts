import { Catch, HttpException, Injectable, type ExceptionFilter } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import type { Request, Response } from "express";
import { RequestContextService } from "./request-context.service.js";
import { StructuredLogger } from "./structured-logger.js";

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
    constructor(
        private readonly requestContext: RequestContextService,
        private readonly logger: StructuredLogger,
    ) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const request = http.getRequest<Request>();
        const response = http.getResponse<Response>();
        const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
        const exceptionResponse =
            exception instanceof HttpException ? exception.getResponse() : undefined;
        const message = this.getMessage(exceptionResponse);
        const businessProcessId = this.requestContext.businessProcessId ?? null;

        if (statusCode >= 500) {
            this.logger.error(
                "http.request.failed",
                undefined,
                JSON.stringify({
                    businessProcessId,
                    statusCode,
                    path: request.originalUrl,
                    exception: exception instanceof Error ? exception.message : "Unknown error",
                }),
            );
        }

        response.status(statusCode).json({
            statusCode,
            error: this.getErrorName(statusCode),
            message,
            businessProcessId,
            path: request.originalUrl,
            timestamp: new Date().toISOString(),
        });
    }

    private getMessage(value: unknown): string | string[] {
        if (typeof value === "string") {
            return value;
        }
        if (
            typeof value === "object" &&
            value !== null &&
            "message" in value &&
            (typeof value.message === "string" || Array.isArray(value.message))
        ) {
            if (typeof value.message === "string") {
                return value.message;
            }
            return value.message.filter(
                (message): message is string => typeof message === "string",
            );
        }
        return "Internal server error";
    }

    private getErrorName(statusCode: number): string {
        return (
            {
                400: "Bad Request",
                401: "Unauthorized",
                403: "Forbidden",
                404: "Not Found",
                409: "Conflict",
                429: "Too Many Requests",
                503: "Service Unavailable",
            }[statusCode] ?? (statusCode >= 500 ? "Internal Server Error" : "Error")
        );
    }
}
