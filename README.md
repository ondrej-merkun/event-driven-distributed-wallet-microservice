# Event-Driven Wallet Microservice

A production-grade event-driven distributed wallet microservice built with NestJS, PostgreSQL, and RabbitMQ. Handles wallet operations with strong consistency guarantees, comprehensive audit trails, and asynchronous event processing.

## Features

- Event sourcing with immutable audit trail
- **Transactional Outbox Pattern** for reliable event publishing
- **Redis Caching** for high-performance balance lookups
- **Read Replicas** support for database scaling
- Idempotent request handling (duplicate request detection)
- Saga pattern for distributed transactions with automatic compensation
- Optimistic locking for concurrent operation handling
- Background fraud detection worker
- RabbitMQ event streaming
- Docker Compose for easy deployment
- Comprehensive test coverage

## Architecture Overview

```
┌─────────────┐       ┌──────────────┐       ┌─────────────┐
│   Client    │──────▶│  API Service │──────▶│  PostgreSQL │
└─────────────┘       └──────────────┘       └──────┬──────┘
                            │                       │ (1. Save Event    to Outbox)
                            │ (2. Poll Outbox)      ▼
                            │                 ┌─────────────┐
                            └────────────────▶│ Outbox Table│
                                              └──────┬──────┘
                                                     │ (3. Publish)
                                                     ▼
                      ┌──────────┐            ┌──────────┐
                      │ RabbitMQ │◀───────────│  Relay   │
                      └──────────┘            └──────────┘
                            │
                            │ (Consumes Events)
                            ▼
                      ┌──────────────┐
                      │Fraud Detection│
                      │    Worker     │
                      └──────────────┘
```

### Module Architecture

**WalletModule**: Wallet lifecycle and single-wallet operations
- **Domain**: `Wallet`, `WalletEvent` entities  
- **Services**: `WalletService` (deposits, withdrawals, balance queries)
- **Repository**: `IWalletRepository` interface + TypeORM implementation

**TransferModule**: Multi-wallet transfer orchestration
- **Domain**: `TransferSaga` entity
- **Services**: `TransferSagaService` (saga orchestration), `SagaRecoveryService`
- **Pattern**: Saga orchestration with compensation

**FraudModule**: Async fraud detection processing
- **Consumers**: `FraudDetectionConsumer` (RabbitMQ)
- **Business Logic**: Rapid withdrawal detection, high-value alerts
- **Pattern**: At-least-once processing with idempotency

**HealthModule**: Operational readiness
- **Endpoints**: `/health`, `/health/live`, `/health/ready`
- **Checks**: Database, RabbitMQ connectivity

**Infrastructure**: Cross-cutting concerns
- **OutboxRelayService**: Reliable event publishing (Outbox pattern)
- **EventPublisher**: RabbitMQ topic exchange publisher
- **Repositories**: Data access abstractions

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Framework**: NestJS 11
- **Runtime**: Node.js 22+
- **Database**: PostgreSQL 17
- **Message Broker**: RabbitMQ
- **Caching/Locking**: Redis
- **API Documentation**: OpenAPI/Swagger
- **Containerization**: Docker & Docker Compose
- **Testing**: Jest, Supertest, fast-check

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Node.js 22+ (for local development)

### Start All Services

```bash
# Start all services with Docker Compose
docker-compose up --build
```

This will start:
- **PostgreSQL** on port 5432
- **RabbitMQ** on ports 5672 (AMQP) and 15672 (Management UI)
- **Redis** on port 6379
- **API Service** on port 3000
- **Fraud Detection Worker** (background service)

The API will be available at `http://localhost:3000`

**Swagger Documentation**: `http://localhost:3000/api`

**RabbitMQ Management UI**: `http://localhost:15672` (username: `wallet`, password: `wallet`)

## API Endpoints

> **Note**: All endpoints are versioned with `/v1/` prefix. The Swagger documentation at `/api` provides interactive testing.

### Deposit Funds
```bash
POST /v1/wallet/:id/deposit
Content-Type: application/json
X-Request-ID: <unique-request-id>

{
  "amount": 100
}

Response:
{
  "walletId": "user-123",
  "balance": 100
}
```

### Withdraw Funds
```bash
POST /v1/wallet/:id/withdraw
Content-Type: application/json
X-Request-ID: <unique-request-id>

{
  "amount": 50
}

Response:
{
  "walletId": "user-123",
  "balance": 50
}
```

### Transfer Funds
```bash
POST /wallet/:id/transfer
Content-Type: application/json
X-Request-ID: <unique-request-id>

{
  "toWalletId": "user-456",
  "amount": 30
}

Response:
{
  "sagaId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "state": "COMPLETED",
  "fromWalletId": "user-123",
  "toWalletId": "user-456",
  "amount": 30
}
```

### Get Wallet Balance
```bash
GET /wallet/:id

Response:
{
  "walletId": "user-123",
  "balance": 70
}
```

### Get Transaction History
```bash
GET /wallet/:id/history?limit=100&offset=0

Response:
[
  {
    "id": 1,
    "eventType": "WALLET_CREATED",
    "amount": null,
    "metadata": null,
    "createdAt": "2023-11-30T10:00:00.000Z"
  },
  {
    "id": 2,
    "eventType": "FUNDS_DEPOSITED",
    "amount": 100,
    "metadata": { "requestId": "req-001" },
    "createdAt": "2023-11-30T10:01:00.000Z"
  }
]
```

### Operational Endpoints & Behaviors

#### Health Monitoring
- `GET /health`: Overall health (200 OK or 503 Service Unavailable)
- `GET /health/live`: Kubernetes liveness probe
- `GET /health/ready`: Kubernetes readiness probe

**Sample Response**:
```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up", "responseTime": 2 },
    "rabbitmq": { "status": "up", "channel": "connected" }
  }
}
```

#### Rate Limiting
- **Global Limit**: 100 requests per minute
- **Withdrawal Limit**: 10 requests per minute
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Response**: 429 Too Many Requests

#### Error Handling
The API uses standard HTTP status codes and a consistent error format:

- `400 Bad Request`: Validation errors
- `422 Unprocessable Entity`: Business rule violations (e.g., Insufficient Funds)
- `409 Conflict`: Optimistic lock errors or duplicate requests
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Unexpected system errors

**Error Response Format**:
```json
{
  "statusCode": 422,
  "error": "InsufficientFundsError",
  "message": "Insufficient funds for withdrawal",
  "timestamp": "2023-11-30T10:00:00.000Z"
}
```

## API Examples

### Basic Workflow

```bash
# 1. Deposit to Alice's wallet
curl -X POST http://localhost:3000/wallet/alice/deposit \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: req-001" \
  -d '{"amount": 100}'

# 2. Check Alice's balance
curl http://localhost:3000/wallet/alice

# 3. Transfer from Alice to Bob
curl -X POST http://localhost:3000/wallet/alice/transfer \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: req-002" \
  -d '{"toWalletId": "bob", "amount": 50}'

# 4. Check both balances
curl http://localhost:3000/wallet/alice
curl http://localhost:3000/wallet/bob

# 5. View transaction history
curl http://localhost:3000/wallet/alice/history
```

### Idempotency Testing

```bash
# First request
curl -X POST http://localhost:3000/wallet/alice/deposit \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: duplicate-test" \
  -d '{"amount": 100}'

# Duplicate request (same X-Request-ID)
curl -X POST http://localhost:3000/wallet/alice/deposit \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: duplicate-test" \
  -d '{"amount": 100}'

# Balance should still be 100, not 200
curl http://localhost:3000/wallet/alice
```

## Running Tests

The project follows the **testing pyramid** with 96 tests across three levels:
- **Unit Tests**: 39 tests (co-located with source code)
- **Integration Tests**: 39 tests (7 test suites in `test/integration/`)
- **E2E Tests**: 18 tests (2 test suites in `test/e2e/`)
- **Stress Tests**: ~12 tests (optional, in `test/stress/`)

### Unit Tests
```bash
# Run unit tests (tests in src/ directory)
npm test

# Run with coverage
npm run test:cov
npm run test:cov:html  # Generate HTML coverage report
```

### Integration Tests
```bash
# Run integration tests
npm run test:integration
```

### E2E Tests
```bash
# Prerequisites: Start services
docker-compose up -d

# Run E2E tests (requires database)
npm run test:e2e
```

### All Tests
```bash
# Run all tests (unit + integration + E2E)
npm run test:all

# Run everything including stress tests
npm run test:full
```

### Stress Tests (Optional)
```bash
# Run stress/chaos tests (not part of regular CI)
npm run test:stress
```

### Run Tests in Docker
```bash
# Build and run tests in Docker environment
docker-compose -f docker-compose.test.yml up --build

# Run all tests in Docker (unit, integration, E2E)
docker-compose -f docker-compose.yml -f docker-compose.test.yml run test npm run test:e2e
```

> **Note:** The test compose file requires the base `docker-compose.yml` file to provide the infrastructure services (postgres, rabbitmq, redis).

## Local Development

### Setup
```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start database and RabbitMQ with Docker Compose
docker-compose up postgres rabbitmq

# Run database migrations (TypeORM will auto-sync in development)

# Start API service
npm run start:dev

# In another terminal, start worker
npm run start:worker:dev
```

### Build
```bash
npm run build
npm start
```

## Project Structure

```
wallet-microservice/
├── src/
│   ├── api/
│   │   ├── controllers/     # REST API controllers
│   │   └── dto/             # Data transfer objects
│   ├── domain/
│   │   ├── entities/        # TypeORM entities
│   │   └── services/        # Business logic services
│   ├── infrastructure/
│   │   ├── database/        # Database configuration
│   │   ├── messaging/       # RabbitMQ publisher & Outbox Relay
│   │   ├── redis/           # Redis configuration
│   │   └── repositories/    # Data access layer
│   ├── workers/
│   │   └── consumers/       # Background event consumers
│   ├── app.module.ts        # Main application module
│   ├── main.ts              # API entry point
│   ├── worker.module.ts     # Worker module
│   └── worker.ts            # Worker entry point
├── test/
│   ├── wallet.e2e-spec.ts   # E2E tests
│   └── load-test.js         # Load testing script
├── docker-compose.yml       # Docker Compose configuration
├── Dockerfile               # Multi-stage build
├── README.md                # This file
└── DESIGN.md                # Architecture decisions
```

## Key Design Decisions

See [DESIGN.md](./DESIGN.md) for detailed architecture decisions and trade-offs.

Key highlights:
- **Event Sourcing**: All wallet operations are recorded as immutable events
- **Transactional Outbox**: Events are saved to DB first, then relayed to RabbitMQ to ensure atomicity
- **Saga Pattern**: Orchestration-based saga for transfers with automatic compensation
- **Optimistic Locking**: Version-based concurrency control in PostgreSQL
- **Idempotency**: Request ID tracking to handle duplicate requests
- **Fraud Detection**: Background worker analyzing withdrawal patterns

## Testing Scenarios Covered

- **Concurrent withdrawals on same wallet** - Only one succeeds if balance insufficient  
- **Bidirectional transfers** - A→B and B→A simultaneously work correctly  
- **Transfer failure with automatic reversal** - Saga compensation tested  
- **Duplicate request handling** - Idempotency verified  
- **1,000+ concurrent operations** - Load test validates scale  
- **Event consumer idempotency** - Background worker handles duplicate events  

## Monitoring

- **RabbitMQ Management UI**: http://localhost:15672
- **Application Logs**: `docker-compose logs -f api` or `docker-compose logs -f worker`
- **Database**: Connect to PostgreSQL on `localhost:5432`

## Troubleshooting

### Services won't start
```bash
# Clean up and restart
docker-compose down -v
docker-compose up --build
```

### Check service health
```bash
docker-compose ps
docker-compose logs api
docker-compose logs worker
```

### Database issues
```bash
# Access PostgreSQL
docker-compose exec postgres psql -U wallet_user -d wallet_db

# Check tables
\dt

# Query wallets
SELECT * FROM wallets;
SELECT * FROM wallet_events;
```

## Production Considerations

For production deployment, consider:

1. **Database Migrations**: Use TypeORM migrations instead of `synchronize: true`
2. **Environment Variables**: Use secrets management (e.g., AWS Secrets Manager)
3. **Monitoring**: Add Prometheus metrics and Grafana dashboards
4. **Logging**: Structured logging with ELK stack or similar
5. **Message Broker**: Configure RabbitMQ clustering for high availability
6. **API Rate Limiting**: Add rate limiting middleware
7. **Authentication**: Add JWT or OAuth2 authentication
8. **Horizontal Scaling**: Deploy multiple API and worker instances
9. **Event Cleanup**: Add job to archive old idempotency keys
10. **Dead Letter Queue**: Implement DLQ processing and alerting

See [docs/PRODUCTION_DEPLOYMENT.md](./docs/PRODUCTION_DEPLOYMENT.md) for complete production deployment guide including:
- Database security configuration
- Audit compliance setup
- Monitoring and alerting
- Backup and recovery procedures

## Security and Compliance

This implementation includes multiple layers of event immutability enforcement:
- Application-level (repository pattern, ORM subscriber)
- Database-level (triggers, permissions, row-level security)

For audit compliance (SOX, PCI-DSS, GDPR), see:
- [docs/EVENT_IMMUTABILITY.md](./docs/EVENT_IMMUTABILITY.md) - Complete immutability explanation
- [docs/PRODUCTION_DEPLOYMENT.md](./docs/PRODUCTION_DEPLOYMENT.md) - Production security setup

## License
