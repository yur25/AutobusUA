import { Injectable, Logger, type LoggerService } from "@nestjs/common";
import { RequestContextService } from "./request-context.service.js";

@Injectable()
export class StructuredLogger implements LoggerService {
    private readonly fallback = new Logger();

    constructor(private readonly requestContext: RequestContextService) {}

    log(message: string, context?: string | Record<string, unknown>): void {
        this.write("info", message, context);
    }

    error(message: string, trace?: string, context?: string | Record<string, unknown>): void {
        this.write("error", message, { trace, context });
    }

    warn(message: string, context?: string | Record<string, unknown>): void {
        this.write("warn", message, context);
    }

    debug(message: string, context?: string | Record<string, unknown>): void {
        this.write("debug", message, context);
    }

    verbose(message: string, context?: string | Record<string, unknown>): void {
        this.write("verbose", message, context);
    }

    private write(
        level: string,
        message: string,
        details?: string | Record<string, unknown>,
    ): void {
        const record = {
            level,
            message,
            businessProcessId: this.requestContext.businessProcessId ?? null,
            ...(typeof details === "string" ? { context: details } : details),
            timestamp: new Date().toISOString(),
        };
        const serialized = JSON.stringify(record);

        if (level === "error") {
            this.fallback.error(serialized);
        } else if (level === "warn") {
            this.fallback.warn(serialized);
        } else if (level === "debug") {
            this.fallback.debug(serialized);
        } else if (level === "verbose") {
            this.fallback.verbose(serialized);
        } else {
            this.fallback.log(serialized);
        }
    }
}
