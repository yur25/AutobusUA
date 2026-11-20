import {
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
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { TicketQueryDto } from "./bookings.dto.js";
import { BookingsService } from "./bookings.service.js";

@Controller()
@UseGuards(SessionAuthGuard)
export class BookingsController {
    constructor(private readonly bookingsService: BookingsService) {}

    @Post("api/v1/trips/:tripId/tickets")
    @RequireRoles("PASSENGER", "CARRIER")
    @UseGuards(RolesGuard)
    purchase(
        @Param("tripId", ParseUUIDPipe) tripId: string,
        @CurrentUser() user: User,
        @Headers("idempotency-key") key: string | undefined,
        @Res({ passthrough: true }) response: Response,
    ) {
        return this.bookingsService
            .purchase(user, tripId, key)
            .then((result) => idempotentResponse(response, result));
    }

    @Get("api/v1/tickets/me")
    @RequireRoles("PASSENGER", "CARRIER")
    @UseGuards(RolesGuard)
    listMine(@CurrentUser() user: User, @Query() query: TicketQueryDto) {
        return this.bookingsService.listMine(user, query);
    }

    @Get("api/v1/tickets/:id")
    findById(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: User) {
        return this.bookingsService.findById(id, user);
    }

    @Post("api/v1/tickets/:id/cancel")
    cancel(
        @Param("id", ParseUUIDPipe) id: string,
        @CurrentUser() user: User,
        @Headers("idempotency-key") key: string | undefined,
        @Res({ passthrough: true }) response: Response,
    ) {
        return this.bookingsService
            .cancel(id, user, key)
            .then((result) => idempotentResponse(response, result));
    }
}
