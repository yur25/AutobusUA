import { NestFactory } from "@nestjs/core";
import { DatabaseModule } from "./common/database.module.js";

async function migrate(): Promise<void> {
    const application = await NestFactory.createApplicationContext(DatabaseModule);
    await application.close();
}

void migrate().catch((error: unknown) => {
    console.error(
        "Database migration failed:",
        error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
});
