import { IsString, IsNotEmpty, IsInt, Min, MaxLength, IsOptional } from 'class-validator';

export class CreateKitchenStationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  branchId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
