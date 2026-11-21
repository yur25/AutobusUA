import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";
import type { ApplicationStatus } from "../../common/domain.js";

export class CarrierApplicationQueryDto {
    @IsOptional()
    @IsIn(["PENDING", "VERIFIED", "REJECTED"])
    status?: ApplicationStatus;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    pageSize?: number;
}

export class RejectApplicationDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}
