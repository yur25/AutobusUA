import { Controller, Get } from "@nestjs/common";
import { BUILD_COMMIT } from "./generated/build-info.js";

@Controller()
export class AppController {
    @Get("health")
    getHealth(): { status: string } {
        return { status: "ok" };
    }

    @Get("version")
    getVersion(): { commit: string } {
        return { commit: BUILD_COMMIT };
    }
}
