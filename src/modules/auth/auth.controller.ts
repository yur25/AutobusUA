import {
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Post,
    Res,
    UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser, Public } from "../../common/auth.decorators.js";
import type { User } from "../../common/domain.js";
import { AuthService, toUserResponse } from "./auth.service.js";
import { LoginDto, RegisterDto } from "./auth.dto.js";
import { SessionAuthGuard, getSessionCookie } from "./session-auth.guard.js";

@Controller("api/v1/auth")
@UseGuards(SessionAuthGuard)
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Public()
    @Post("register")
    @HttpCode(HttpStatus.CREATED)
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Public()
    @Post("login")
    @HttpCode(HttpStatus.OK)
    async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
        const result = await this.authService.login(dto);
        response.setHeader("Set-Cookie", result.cookie);
        return { user: result.user };
    }

    @Post("logout")
    @HttpCode(HttpStatus.NO_CONTENT)
    logout(
        @Headers("cookie") cookieHeader: string | undefined,
        @Res({ passthrough: true }) response: Response,
    ): void {
        const sessionId = getSessionCookie(cookieHeader);
        if (sessionId) {
            this.authService.logout(sessionId);
        }
        response.setHeader("Set-Cookie", this.authService.clearCookie());
    }

    @Get("me")
    getMe(@CurrentUser() user: User) {
        return toUserResponse(user);
    }
}
