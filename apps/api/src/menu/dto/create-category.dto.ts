import { IsString, IsNotEmpty, IsOptional, MaxLength, IsInt } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  branchId!: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
