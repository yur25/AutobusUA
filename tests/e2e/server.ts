import { once } from "node:events";
import type { ChildProcess } from "node:child_process";

export async function waitForServerPort(child: ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Application startup timed out after 30 seconds"));
        }, 30_000);
        const cleanup = (): void => {
            clearTimeout(timer);
            child.off("message", onMessage);
            child.off("exit", onExit);
            child.off("error", onError);
        };
        const onMessage = (message: unknown): void => {
            if (
                typeof message !== "object" ||
                message === null ||
                !("type" in message) ||
                message.type !== "listening" ||
                !("port" in message) ||
                typeof message.port !== "number" ||
                !Number.isInteger(message.port) ||
                message.port < 1 ||
                message.port > 65535
            ) {
                cleanup();
                reject(new Error("Application sent an invalid startup message"));
                return;
            }
            cleanup();
            resolve(message.port);
        };
        const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
            cleanup();
            reject(new Error(`Application exited before startup: ${code ?? signal}`));
        };
        const onError = (error: Error): void => {
            cleanup();
            reject(error);
        };
        child.on("message", onMessage);
        child.once("exit", onExit);
        child.once("error", onError);
    });
}

export async function stopServer(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
    }
}
