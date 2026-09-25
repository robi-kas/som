import { IsString, IsNotEmpty, MinLength, MaxLength, Matches, IsOptional, IsArray, ArrayMaxSize } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  lastName!: string;

  @IsString()
  @Matches(/^[a-z0-9._-]{3,40}$/, { message: 'Username must be 3–40 lowercase letters, digits, dot, dash or underscore' })
  username!: string;

  // Required: there is no default password any more.
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  roleName!: string;

  @IsString()
  @IsNotEmpty()
  branchId!: string;

  /** Prep stations for station staff (barista → Coffee). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  stationIds?: string[];
}

export class SetStationsDto {
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  stationIds!: string[];
}
