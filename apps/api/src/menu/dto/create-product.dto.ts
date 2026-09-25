import { IsString, IsNotEmpty, IsUUID, IsOptional, MaxLength, IsDecimal } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsString()
  @IsNotEmpty()
  branchId!: string;

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  preparationStationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @IsDecimal({ decimal_digits: '0,2' })
  price!: string;
}
