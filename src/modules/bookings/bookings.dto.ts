import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import type { TicketStatus } from "../../common/domain.js";

export class TicketQueryDto {
    @IsOptional()
    @IsIn(["ACTIVE", "CANCELLED"])
    status?: TicketStatus;

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
