import { Global, Module } from "@nestjs/common";
import { CommonModule } from "./common.module.js";
import { DatabaseService } from "./database.service.js";
import { IDEMPOTENCY_STORE } from "./idempotency.js";
import { PostgresIdempotencyStore } from "./postgres-idempotency.store.js";

@Global()
@Module({
    imports: [CommonModule],
    providers: [
        DatabaseService,
        PostgresIdempotencyStore,
        { provide: IDEMPOTENCY_STORE, useExisting: PostgresIdempotencyStore },
    ],
    exports: [DatabaseService, IDEMPOTENCY_STORE],
})
export class DatabaseModule {}
