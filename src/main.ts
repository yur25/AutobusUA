import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);

    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
        }),
    );
    app.enableShutdownHooks();
    await app.init();
    await app.listen(process.env.PORT ?? 3000);
}

void bootstrap().catch((error: unknown) => {
    console.error(
        "Application startup failed:",
        error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
});
