import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const commit =
    process.env.GIT_COMMIT?.trim() ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

if (!/^[\da-f]{40,64}$/i.test(commit)) {
    throw new Error("GIT_COMMIT must contain a full Git commit SHA.");
}

const outputPath = resolve("src/generated/build-info.ts");
const output = `export const BUILD_COMMIT = ${JSON.stringify(commit)};\n`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, "utf8");
