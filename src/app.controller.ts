import { Controller, Get } from "@nestjs/common";
import { BUILD_COMMIT } from "./generated/build-info.js";
import { DatabaseService } from "./common/database.service.js";

@Controller()
export class AppController {
    constructor(private readonly database: DatabaseService) {}

    @Get("health")
    getHealth(): { status: string } {
        return { status: "ok" };
    }

    @Get("version")
    getVersion(): { commit: string } {
        return { commit: BUILD_COMMIT };
    }

    @Get("health/ready")
    async getReadiness(): Promise<{ status: string; storage: string }> {
        await this.database.checkReadiness();
        return {
            status: "ok",
            storage: "postgresql",
        };
    }
}
