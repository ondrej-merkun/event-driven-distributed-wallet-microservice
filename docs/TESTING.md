# Testing

This document outlines the testing approach for the wallet microservice. The test suite covers unit tests, integration tests, end-to-end scenarios, and load testing.

## Test Structure

Tests are organized into four layers:

1. **Unit Tests** - Domain logic and business rules
2. **Integration Tests** - Infrastructure components (outbox relay, saga recovery)
3. **E2E Tests** - Full system behavior with real database/Redis
4. **Load Tests** - Performance validation using k6

---

## Unit Tests

### Wallet Entity
`src/modules/wallet/entities/wallet.entity.spec.ts`

Tests core wallet operations:
- Deposits and withdrawals
- Insufficient funds handling
- wallet state transitions (active, frozen, closed)
- Daily withdrawal limits

### Property-Based Testing
`src/modules/wallet/entities/wallet.entity.property.spec.ts`

Uses fast-check to fuzz wallet operations and verify invariants hold across arbitrary sequences. Helps catch edge cases that manual tests might miss.

### Fraud Detection Consumer
`src/workers/consumers/fraud-detection.consumer.spec.ts`

Tests event processing and alert generation logic.

### Transfer Saga
`src/modules/transfer/entities/transfer-saga.entity.spec.ts`

Tests state machine transitions (PENDING → DEBITED → COMPLETED/COMPENSATED).

### Transfer Saga Property Tests
`src/modules/transfer/entities/transfer-saga.entity.property.spec.ts`

Verifies invariants:
- State transitions are monotonic (cannot go back to PENDING)
- Saga cannot be in multiple terminal states
- Metadata consistency for failure/compensation reasons

---

## Integration Tests

### Outbox Relay
`test/integration/outbox-relay.integration.spec.ts`

Tests the transactional outbox pattern:
- Events persisted atomically with business state
- Relay to RabbitMQ with at-least-once delivery
- Handling message broker failures
- Duplicate event detection

### Saga Recovery
`test/integration/saga-recovery.integration.spec.ts`

Tests saga state machine transitions:
- Recovery of stuck sagas (e.g., DEBITED → COMPLETED)
- Compensation logic for failed transfers
- Timeout handling and retry strategies

---

## E2E Tests

All E2E tests run against real Postgres + Redis instances.

### Core Wallet Operations
`test/e2e/wallet.e2e-spec.ts` (314 lines)

**Basic operations:**
- Create wallet, deposit, withdraw, get balance
- Transaction history with pagination
- Input validation (negative amounts, etc.)

**Idempotency:**
- Duplicate deposit requests return cached results
- Duplicate transfer requests prevent double-debit
- Uses Redis distributed locks (SETNX pattern)

**Transfers:**
- Happy path: debit sender, credit receiver
- Bidirectional transfers (A→B and B→A concurrently)
- Insufficient funds handling

**Concurrency:**
- Concurrent withdrawals on same wallet (only one succeeds)
- 100+ concurrent deposits to different wallets
- Balance correctness under load

### Reliability
`test/e2e/reliability.e2e-spec.ts`

**Saga recovery scenario:**
Simulates a pod crash after debit but before credit by manually inserting a saga in DEBITED state. The saga recovery service should detect and complete it.

This validates the system can recover from mid-flight failures without losing money.

### Advanced Concurrency
`test/e2e/advanced-concurrency.e2e-spec.ts`

**Idempotency race condition:**
10 concurrent requests with the same Request-ID. Only one should execute; others return 409 Conflict or cached result. Tests Redis lock implementation.

**Deadlock prevention:**
10 bidirectional transfers (A→B, B→A) running simultaneously. Alphabetical wallet ID ordering prevents circular wait. All transfers should complete successfully.

### Chaos Engineering
`test/e2e/chaos.e2e-spec.ts` (262 lines)

Tests system behavior under failure conditions:

**Database resilience:**
- Serialization conflict handling with retries
- Transaction rollback on failures
- Saga compensation

**Consistency under failure:**
- Total balance across wallets remains constant even if sagas fail
- 50 concurrent withdrawals - balance never goes negative
- No money creation or loss

**Idempotency under chaos:**
- Multiple duplicate requests during simulated network issues
- Balance increases only once despite retries

**Saga recovery under stress:**
- Multiple concurrent transfers
- All sagas eventually reach terminal state

### Exception Handling
`test/e2e/exception-filters.e2e-spec.ts`

Validates HTTP semantics:
- 400 for validation errors
- 404 for missing resources
- 422 for business rule violations
- 500 for server errors
- All error responses include correlation IDs

### Rate Limiting
`test/e2e/rate-limiting.e2e-spec.ts`

Tests Redis-based rate limiting:
- Per-wallet limits enforced
- 429 responses after threshold exceeded

### Health Checks
`test/e2e/health.e2e-spec.ts`

Validates `/health` endpoint for k8s probes:
- Database connectivity
- Redis connectivity

### Event Immutability
`test/event-immutability.spec.ts`

Verifies database triggers prevent UPDATE/DELETE on `wallet_events` table. Ensures audit trail can't be tampered with.

---

## Load Testing

### k6 Suite
`test/load-test.k6.js`

Three scenarios running concurrently:

**1. Concurrent deposits** (20 VUs, 1000 iterations)
- Different wallets, minimal contention
- Tests overall throughput

**2. Same wallet operations** (10 VUs, 100 iterations)
- High contention on single wallet
- Tests pessimistic locking performance

**3. Concurrent transfers** (10 VUs, 50 iterations)
- Full saga orchestration under load
- Tests distributed transaction throughput

**Performance thresholds:**
- Error rate < 1%
- p95 latency < 500ms

Run with:
```bash
docker run --rm -i grafana/k6 run - < test/load-test.k6.js
```

---
### Docker Test Execution (Recommended for Accuracy)

While `npm` commands are faster for local development loops, running tests via Docker ensures the environment matches production exactly (Node version, OS dependencies, network latency).

```bash
# Run all tests in Docker
docker-compose run --rm test

# Run specific suite
docker-compose run --rm test npm run test:e2e:stress
```

## Npm Test Execution

The test suite has three modes based on Jest configs:

### Quick (CI)
```bash
npm run test:e2e:quick
```
Reduced iterations for fast feedback. ~2-5 minutes.

### Standard
```bash
npm run test:e2e
```
Full coverage. ~10-15 minutes. Run before merging.

### Stress
```bash
npm run test:e2e:stress
```
Maximum concurrency and chaos scenarios. ~30 minutes. Run before deployments.

### Other commands
```bash
npm run test              # Unit tests
npm run test:integration  # Integration tests
npm run test:load         # k6 load tests
```
---

## Test Infrastructure

### Shared Test App
`test/shared/shared-test-app.ts`

Single NestJS app instance reused across all E2E tests for faster execution. Database is isolated via `TRUNCATE` in `beforeEach` hooks.

### Setup
`test/setup.ts`

Configures Postgres with SERIALIZABLE isolation level and Redis for distributed locks.

---

## Coverage

The test suite includes:
- 40+ E2E scenarios
- 8 chaos/failure scenarios
- Concurrency tests up to 100 parallel operations
- All saga state transitions covered

## TODO

- Add contract testing (Pact) if we expose this as an API to other services
- Consider mutation testing (Stryker) to validate test quality
- More comprehensive fraud detection scenarios
