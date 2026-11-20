import { existsSync } from "node:fs";
import process from "node:process";

if (existsSync(".env")) {
    process.loadEnvFile(".env");
}

await import("../src/main.ts");
