import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsArray,
  ValidateNested,
  IsNotEmpty,
  IsIn,
  MaxLength,
  ArrayMaxSize,
  ArrayMinSize,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDraftOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  branchId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tableId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['DINE_IN', 'TAKEAWAY', 'DELIVERY'])
  type?: string;
}

export class OrderItemInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;

  /** Ids of ProductModifier rows. The server looks up names and prices; the client never sends a price. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  modifierIds?: string[];
}

export class AddItemsToOrderDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
}

export class VoidOrderItemDto {
  @IsInt()
  @Min(1)
  orderVersion!: number;

  @IsInt()
  @Min(1)
  itemVersion!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;
}

export class FireOrderDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ServeItemsDto {
  /** Items to mark served. Omit to serve every item that is READY. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds?: string[];
}

export class ApplyDiscountDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn(['PERCENT', 'FIXED', 'NONE'])
  type!: 'PERCENT' | 'FIXED' | 'NONE';

  /** Percent (0–100) or a fixed ETB amount, as a string like "10" or "25.50". */
  @IsOptional()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class TransferTableDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  toTableId!: string;
}
