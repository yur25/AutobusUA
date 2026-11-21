import { Type } from "class-transformer";
import {
    IsDateString,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
} from "class-validator";

export class CreateTripDto {
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    origin!: string;

    @IsString()
    @MinLength(2)
    @MaxLength(120)
    destination!: string;

    @IsDateString()
    @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
    departureAt!: string;

    @IsDateString()
    @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
    arrivalAt!: string;

    @IsString()
    @Matches(/^(?!0(?:\.0{1,2})?$)\d{1,8}(?:\.\d{1,2})?$/)
    price!: string;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(1000)
    capacity!: number;
}

export class TripSearchQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(120)
    origin?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    destination?: string;

    @IsOptional()
    @IsDateString()
    departureFrom?: string;

    @IsOptional()
    @IsDateString()
    departureTo?: string;

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
