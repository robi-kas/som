import { IsString, IsNotEmpty, IsInt, Min, MaxLength } from 'class-validator';

export class CreateTableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name!: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsString()
  @IsNotEmpty()
  branchId!: string;
}
