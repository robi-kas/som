import {
  IsString, IsOptional, IsArray, ValidateNested, IsInt, Min, Max, IsDateString, IsNotEmpty, MaxLength, ArrayMaxSize, ArrayMinSize, IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SyncEventItemDto {
  @IsString() @IsNotEmpty() @MaxLength(64) productId!: string;
  @IsInt() @Min(1) @Max(99) quantity!: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) modifierIds?: string[];
}

export class SyncEventPayloadDto {
  @IsString() @IsNotEmpty() @MaxLength(64) branchId!: string;
  @IsOptional() @IsString() @MaxLength(64) tableId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SyncEventItemDto)
  items!: SyncEventItemDto[];
}

export class SyncEventDto {
  @IsString() @IsNotEmpty() @MaxLength(100) localEventId!: string;
  @IsIn(['Order']) entityType!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) entityId!: string;
  @IsIn(['ORDER_SUBMITTED']) eventType!: string;

  @ValidateNested()
  @Type(() => SyncEventPayloadDto)
  payload!: SyncEventPayloadDto;

  @IsDateString() clientTimestamp!: string;
}

export class SyncBatchDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SyncEventDto)
  events!: SyncEventDto[];
}
