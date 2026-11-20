import {
    Body,
    Controller,
    Get,
    Headers,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Res,
    UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, RequireRoles } from "../../common/auth.decorators.js";
import type { User } from "../../common/domain.js";
import { idempotentResponse } from "../../common/idempotency-response.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { CarrierApplicationQueryDto, RejectApplicationDto } from "./carriers.dto.js";
import { CarriersService } from "./carriers.service.js";

@Controller("api/v1/carrier-applications")
@UseGuards(SessionAuthGuard)
export class CarriersController {
    constructor(private readonly carriersService: CarriersService) {}

    @Post()
    apply(
        @CurrentUser() user: User,
        @Headers("idempotency-key") key: string | undefined,
        @Res({ passthrough: true }) response: Response,
    ) {
        return this.carriersService
            .apply(user, key)
            .then((result) => idempotentResponse(response, result));
    }

    @Get("me")
    listMine(@CurrentUser() user: User, @Query() query: CarrierApplicationQueryDto) {
        return this.carriersService.listMine(user, query);
    }

    @Get()
    @RequireRoles("ADMIN")
    @UseGuards(RolesGuard)
    listAll(@Query() query: CarrierApplicationQueryDto) {
        return this.carriersService.listAll(query, query.status);
    }

    @Post(":id/approve")
    @RequireRoles("ADMIN")
    @UseGuards(RolesGuard)
    approve(
        @Param("id", ParseUUIDPipe) id: string,
        @CurrentUser() admin: User,
        @Headers("idempotency-key") key: string | undefined,
        @Res({ passthrough: true }) response: Response,
    ) {
        return this.carriersService
            .review(id, admin, "VERIFIED", key)
            .then((result) => idempotentResponse(response, result));
    }

    @Post(":id/reject")
    @RequireRoles("ADMIN")
    @UseGuards(RolesGuard)
    reject(
        @Param("id", ParseUUIDPipe) id: string,
        @CurrentUser() admin: User,
        @Headers("idempotency-key") key: string | undefined,
        @Body() dto: RejectApplicationDto,
        @Res({ passthrough: true }) response: Response,
    ) {
        return this.carriersService
            .review(id, admin, "REJECTED", key, dto.reason)
            .then((result) => idempotentResponse(response, result));
    }
}
