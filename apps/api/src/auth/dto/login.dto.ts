import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  organizationSlug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  newPassword!: string;
}
