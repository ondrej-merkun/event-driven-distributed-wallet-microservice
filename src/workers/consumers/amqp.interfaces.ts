export interface AmqpMessage {
  content: Buffer;
  properties: {
    headers?: Record<string, any>;
    deliveryMode?: number;
    [key: string]: any;
  };
  fields: {
    deliveryTag: number;
    redelivered: boolean;
    exchange: string;
    routingKey: string;
    [key: string]: any;
  };
}

export interface WalletEventPayload {
  walletId: string;
  eventType: string;
  amount?: number;
  timestamp: string | Date;
  metadata?: Record<string, any>;
}

export interface AmqpChannel {
  assertExchange(exchange: string, type: string, options?: any): Promise<any>;
  assertQueue(queue: string, options?: any): Promise<any>;
  bindQueue(queue: string, source: string, pattern: string, args?: any): Promise<any>;
  prefetch(count: number, global?: boolean): Promise<any>;
  consume(queue: string, onMessage: (msg: AmqpMessage | null) => void, options?: any): Promise<any>;
  ack(message: AmqpMessage, allUpTo?: boolean): void;
  nack(message: AmqpMessage, allUpTo?: boolean, requeue?: boolean): void;
  sendToQueue(queue: string, content: Buffer, options?: any): boolean;
}
