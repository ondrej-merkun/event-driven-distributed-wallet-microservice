import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
} from '@nestjs/swagger';
import { WalletService } from '../services/wallet.service';
import { TransferSagaService } from '../../transfer/services/transfer-saga.service';
import { DepositDto, WithdrawDto, TransferDto, GetHistoryDto } from '../dtos/wallet.dto';

@ApiTags('wallet')
@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(
    private walletService: WalletService,
    private transferSagaService: TransferSagaService,
  ) {}

  @Post(':id/deposit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deposit funds into a wallet' })
  @ApiParam({ name: 'id', description: 'Wallet ID' })
  @ApiHeader({
    name: 'X-Request-ID',
    description: 'Idempotency key for duplicate request detection',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Deposit successful' })
  @ApiResponse({ status: 400, description: 'Invalid amount' })
  async deposit(
    @Param('id') walletId: string,
    @Body() depositDto: DepositDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    this.logger.log(`Deposit request: ${walletId}, amount: ${depositDto.amount}, requestId: ${requestId}`);
    return this.walletService.deposit(walletId, depositDto.amount, requestId);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw funds from a wallet' })
  @ApiParam({ name: 'id', description: 'Wallet ID' })
  @ApiHeader({
    name: 'X-Request-ID',
    description: 'Idempotency key for duplicate request detection',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Withdrawal successful' })
  @ApiResponse({ status: 400, description: 'Invalid amount or insufficient funds' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async withdraw(
    @Param('id') walletId: string,
    @Body() withdrawDto: WithdrawDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    this.logger.log(`Withdraw request: ${walletId}, amount: ${withdrawDto.amount}, requestId: ${requestId}`);
    return this.walletService.withdraw(walletId, withdrawDto.amount, requestId);
  }

  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer funds between wallets using saga orchestration' })
  @ApiParam({ name: 'id', description: 'Source wallet ID' })
  @ApiHeader({
    name: 'X-Request-ID',
    description: 'Idempotency key for duplicate request detection',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Transfer initiated/completed' })
  @ApiResponse({ status: 400, description: 'Invalid transfer (same wallet, insufficient funds, currency mismatch)' })
  @ApiResponse({ status: 404, description: 'Source wallet not found' })
  async transfer(
    @Param('id') fromWalletId: string,
    @Body() transferDto: TransferDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    this.logger.log(
      `Transfer request: ${fromWalletId} -> ${transferDto.toWalletId}, amount: ${transferDto.amount}, requestId: ${requestId}`,
    );
    return this.transferSagaService.executeTransfer(
      fromWalletId,
      transferDto.toWalletId,
      transferDto.amount,
      requestId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get wallet balance' })
  @ApiParam({ name: 'id', description: 'Wallet ID' })
  @ApiResponse({ status: 200, description: 'Returns wallet balance' })
  async getBalance(@Param('id') walletId: string) {
    return this.walletService.getBalance(walletId);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get wallet transaction history' })
  @ApiParam({ name: 'id', description: 'Wallet ID' })
  @ApiResponse({ status: 200, description: 'Returns list of wallet events' })
  async getHistory(
    @Param('id') walletId: string,
    @Query() query: GetHistoryDto,
  ) {
    const limit = query.limit || 100;
    const offset = query.offset || 0;
    return this.walletService.getHistory(walletId, limit, offset);
  }
}
