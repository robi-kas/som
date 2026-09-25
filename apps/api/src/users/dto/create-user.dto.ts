import { IsNotEmpty, IsString, MaxLength, MinLength, IsArray, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsArray()
  @IsString({ each: true })
  branchIds!: string[];

  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];
}
