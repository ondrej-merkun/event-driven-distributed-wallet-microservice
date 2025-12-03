export const FRAUD_CONSTANTS = {
  ROUTING_KEYS: {
    FUNDS_WITHDRAWN: 'wallet.funds_withdrawn',
    TRANSFER_COMPLETED: 'wallet.transfer_completed',
  },
  REDIS_KEYS: {
    PROCESSED_EVENT_PREFIX: 'processed_event:',
    WITHDRAWALS_PREFIX: 'withdrawals:',
  },
  RETRY: {
    DELAYS: [1000, 2000, 4000],
    MAX_ATTEMPTS: 3,
  },
  AMQP: {
    EXCHANGE_TYPE: 'topic',
    DLX_SUFFIX: '.dlx',
    DLQ_SUFFIX: '.dlq',
    WAIT_QUEUE_SUFFIX: '.wait.',
    DLQ_BINDING_KEY: '#',
  },
  HEADERS: {
    DEAD_LETTER_EXCHANGE: 'x-dead-letter-exchange',
    MESSAGE_TTL: 'x-message-ttl',
    RETRY_COUNT: 'x-retry-count',
  },
  ALERTS: {
    HIGH_VALUE_TRANSACTION: 'high_value_transaction',
    RAPID_WITHDRAWALS: 'rapid_withdrawals',
  },
  CRYPTO: {
    ALGORITHM: 'sha256',
    ENCODING: 'hex',
  },
  REDIS: {
    SCORE_MIN: '-inf',
  },
  IDEMPOTENCY_TTL: 24 * 60 * 60, // 24 hours
};
