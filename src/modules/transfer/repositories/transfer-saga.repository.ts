import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TransferSaga, TransferSagaState } from '../entities/transfer-saga.entity';

@Injectable()
export class TransferSagaRepository {
  private repository: Repository<TransferSaga>;

  constructor(_dataSource: DataSource) {
    this.repository = _dataSource.getRepository(TransferSaga);
  }

  async save(saga: TransferSaga): Promise<TransferSaga> {
    return this.repository.save(saga);
  }

  async findById(id: string): Promise<TransferSaga | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByState(state: TransferSagaState): Promise<TransferSaga[]> {
    return this.repository.find({ where: { state } });
  }

  async find(options: any): Promise<TransferSaga[]> {
    return this.repository.find(options);
  }
}
