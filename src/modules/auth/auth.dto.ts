import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    fullName!: string;

    @IsString()
    @Matches(/^\+?[\d\s()-]{8,24}$/)
    phone!: string;

    @IsString()
    @MinLength(12)
    @MaxLength(128)
    password!: string;
}

export class LoginDto {
    @IsString()
    @Matches(/^\+?[\d\s()-]{8,24}$/)
    phone!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(128)
    password!: string;
}
