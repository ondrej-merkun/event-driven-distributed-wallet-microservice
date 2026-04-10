import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AppConfigService } from '../../src/config/app-config.service';
import { TransferSaga, TransferSagaState } from '../../src/modules/transfer/entities/transfer-saga.entity';
import { TransferSagaRepository } from '../../src/modules/transfer/repositories/transfer-saga.repository';
import { Wallet } from '../../src/modules/wallet/entities/wallet.entity';
import { configureTestApp } from '../shared/shared-test-app';
import { SagaRecoveryService } from '../../src/workers/saga-recovery.service';

describe('SagaRecovery Integration Tests', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let configService: AppConfigService;
  let sagaRecoveryService: SagaRecoveryService;
  let transferSagaRepository: TransferSagaRepository;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureTestApp(app);
    await app.init();

    dataSource = moduleFixture.get<DataSource>(DataSource);
    configService = moduleFixture.get<AppConfigService>(AppConfigService);
    sagaRecoveryService = moduleFixture.get<SagaRecoveryService>(SagaRecoveryService);
    transferSagaRepository = moduleFixture.get<TransferSagaRepository>(TransferSagaRepository);
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE wallets, transfer_sagas, wallet_events, outbox_events CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('completes stale DEBITED sagas', async () => {
    const { senderId, receiverId } = await createWalletPair('complete', 50, 0);
    const saga = await insertSaga({
      amount: 50,
      fromWalletId: senderId,
      state: TransferSagaState.DEBITED,
      toWalletId: receiverId,
      updatedAt: oldEnoughDate(configService.sagaStuckThreshold),
    });

    await sagaRecoveryService.processStuckSagas();

    const recovered = await transferSagaRepository.findById(saga.id);
    const receiver = await dataSource.getRepository(Wallet).findOneBy({ id: receiverId });

    expect(recovered?.state).toBe(TransferSagaState.COMPLETED);
    expect(Number(receiver?.balance)).toBe(50);
  });

  it('ignores stale sagas that are not in DEBITED state', async () => {
    const { senderId, receiverId } = await createWalletPair('pending', 100, 0);
    const saga = await insertSaga({
      amount: 50,
      fromWalletId: senderId,
      state: TransferSagaState.PENDING,
      toWalletId: receiverId,
      updatedAt: oldEnoughDate(configService.sagaStuckThreshold),
    });

    await sagaRecoveryService.processStuckSagas();

    const afterRecovery = await transferSagaRepository.findById(saga.id);
    const receiver = await dataSource.getRepository(Wallet).findOneBy({ id: receiverId });

    expect(afterRecovery?.state).toBe(TransferSagaState.PENDING);
    expect(Number(receiver?.balance)).toBe(0);
  });

  it('ignores recently updated DEBITED sagas', async () => {
    const { senderId, receiverId } = await createWalletPair('recent', 50, 0);
    const saga = await insertSaga({
      amount: 50,
      fromWalletId: senderId,
      state: TransferSagaState.DEBITED,
      toWalletId: receiverId,
      updatedAt: new Date(),
    });

    await sagaRecoveryService.processStuckSagas();

    const afterRecovery = await transferSagaRepository.findById(saga.id);
    const receiver = await dataSource.getRepository(Wallet).findOneBy({ id: receiverId });

    expect(afterRecovery?.state).toBe(TransferSagaState.DEBITED);
    expect(Number(receiver?.balance)).toBe(0);
  });

  it('does not double-credit when recovery is triggered concurrently', async () => {
    const { senderId, receiverId } = await createWalletPair('concurrent', 50, 0);
    const saga = await insertSaga({
      amount: 50,
      fromWalletId: senderId,
      state: TransferSagaState.DEBITED,
      toWalletId: receiverId,
      updatedAt: oldEnoughDate(configService.sagaStuckThreshold),
    });

    await Promise.all([
      sagaRecoveryService.processStuckSagas(),
      sagaRecoveryService.processStuckSagas(),
      sagaRecoveryService.processStuckSagas(),
    ]);

    const afterRecovery = await transferSagaRepository.findById(saga.id);
    const receiver = await dataSource.getRepository(Wallet).findOneBy({ id: receiverId });

    expect(afterRecovery?.state).toBe(TransferSagaState.COMPLETED);
    expect(Number(receiver?.balance)).toBe(50);
  });

  async function createWalletPair(
    prefix: string,
    senderBalance: number,
    receiverBalance: number,
  ): Promise<{ senderId: string; receiverId: string }> {
    const senderId = `${prefix}-sender`;
    const receiverId = `${prefix}-receiver`;

    const sender = new Wallet(senderId, 'USD');
    sender.balance = senderBalance;

    const receiver = new Wallet(receiverId, 'USD');
    receiver.balance = receiverBalance;

    await dataSource.manager.save([sender, receiver]);

    return { senderId, receiverId };
  }

  async function insertSaga(params: {
    fromWalletId: string;
    toWalletId: string;
    amount: number;
    state: TransferSagaState;
    updatedAt: Date;
  }): Promise<TransferSaga> {
    const saga = new TransferSaga(
      params.fromWalletId,
      params.toWalletId,
      params.amount,
      'USD',
    );
    saga.state = params.state;

    const savedSaga = await dataSource.manager.save(saga);
    await dataSource.query(
      `
        UPDATE transfer_sagas
        SET created_at = $2, updated_at = $2
        WHERE id = $1
      `,
      [savedSaga.id, params.updatedAt],
    );

    return (await transferSagaRepository.findById(savedSaga.id))!;
  }
});

function oldEnoughDate(stuckThresholdMs: number): Date {
  return new Date(Date.now() - stuckThresholdMs - 1_000);
}
