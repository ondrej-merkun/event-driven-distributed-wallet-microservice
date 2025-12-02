import { IsNumber, IsPositive, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DepositDto {
  @ApiProperty({
    description: 'Amount to deposit (must be positive)',
    example: 100.00,
    minimum: 0.01,
  })
  @IsNumber()
  @IsPositive()
  amount!: number;
}

export class WithdrawDto {
  @ApiProperty({
    description: 'Amount to withdraw (must be positive)',
    example: 50.00,
    minimum: 0.01,
  })
  @IsNumber()
  @IsPositive()
  amount!: number;
}

export class TransferDto {
  @ApiProperty({
    description: 'Destination wallet ID',
    example: 'recipient-wallet-123',
  })
  @IsString()
  toWalletId!: string;

  @ApiProperty({
    description: 'Amount to transfer (must be positive)',
    example: 25.00,
    minimum: 0.01,
  })
  @IsNumber()
  @IsPositive()
  amount!: number;
}

export class GetHistoryDto {
  @ApiPropertyOptional({
    description: 'Maximum number of events to return',
    example: 100,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 100;

  @ApiPropertyOptional({
    description: 'Number of events to skip (for pagination)',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  offset?: number = 0;
}
