import { IsBoolean, IsIn, IsInt, IsIP, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested, IsArray, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePrinterDto {
  @IsString() @IsNotEmpty() branchId!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
  @IsIn(['KITCHEN', 'RECEIPT']) kind!: 'KITCHEN' | 'RECEIPT';
  @IsOptional() @IsString() stationId?: string;
  @IsIP() ipAddress!: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
}

export class UpdatePrinterDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsIP() ipAddress?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() stationId?: string;
}

export class CreatePrintAgentDto {
  @IsString() @IsNotEmpty() branchId!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) name!: string;
}

export class JobResultDto {
  @IsBoolean() ok!: boolean;
  @IsOptional() @IsString() @MaxLength(500) error?: string;
}

export class PrinterStatusDto {
  @IsString() id!: string;
  @IsBoolean() online!: boolean;
  @IsOptional() @IsString() @MaxLength(500) error?: string;
}

export class HeartbeatDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PrinterStatusDto)
  printers?: PrinterStatusDto[];
}
