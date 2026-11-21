import {
    Body,
    Controller,
    Get,
    Headers,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, Public, RequireRoles } from "../../common/auth.decorators.js";
import type { User } from "../../common/domain.js";
import { idempotentResponse } from "../../common/idempotency-response.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { AuthenticatedRequest } from "../auth/session-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { CreateTripDto, TripSearchQueryDto } from "./trips.dto.js";
import { TripsService } from "./trips.service.js";

@Controller("api/v1/trips")
@UseGuards(SessionAuthGuard)
export class TripsController {
    constructor(private readonly tripsService: TripsService) {}

    @Public()
    @Get()
    search(@Query() query: TripSearchQueryDto, @Req() request: AuthenticatedRequest) {
        return this.tripsService.search(query, request.user);
    }

    @Get("mine")
    @RequireRoles("CARRIER")
    @UseGuards(RolesGuard)
    listMine(@CurrentUser() user: User, @Query() query: TripSearchQueryDto) {
        return this.tripsService.listMine(user, query);
    }

    @Post()
    @RequireRoles("CARRIER")
    @UseGuards(RolesGuard)
    create(
        @CurrentUser() user: User,
        @Body() dto: CreateTripDto,
        @Headers("idempotency-key") key: string | undefined,
        @Res({ passthrough: true }) response: Response,
    ) {
        return this.tripsService
            .create(user, dto, key)
            .then((result) => idempotentResponse(response, result));
    }

    @Public()
    @Get(":id")
    findById(@Param("id", ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) {
        return this.tripsService.findById(id, request.user);
    }
}
