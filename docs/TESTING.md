# Testing

This document describes the test inventory that currently exists in the repository and how each layer is used.

## Test Structure

The suite is split into five layers:

1. **Unit tests** for domain logic and focused service regressions
2. **Integration tests** for infrastructure and cross-module behavior
3. **API E2E tests** for the main Nest application bootstrap used in tests
4. **Stress tests** for correctness under concurrency and failure
5. **Load tests** for throughput and latency

---

## Unit Tests

### Wallet Entity
`src/modules/wallet/entities/wallet.entity.spec.ts`

Validates wallet business rules such as deposits, withdrawals, insufficient funds, and wallet status transitions.

### Wallet Property Tests
`src/modules/wallet/entities/wallet.entity.property.spec.ts`

Uses `fast-check` to exercise wallet invariants across arbitrary operation sequences.

### Transfer Saga Entity
`src/modules/transfer/entities/transfer-saga.entity.spec.ts`

Checks the transfer saga state machine and terminal-state metadata behavior.

### Transfer Saga Property Tests
`src/modules/transfer/entities/transfer-saga.entity.property.spec.ts`

Verifies monotonic state transitions and other saga invariants.

### Transfer Saga Service Regression
`src/modules/transfer/services/transfer-saga.service.spec.ts`

Covers the broker-failure regression fixed in issue #1:
- `TRANSFER_INITIATED` publish failure after the create transaction commits
- `TRANSFER_COMPLETED` publish failure after funds move
- terminal saga state remains `COMPLETED` after post-commit publish errors

### Fraud Detection Consumer
`src/workers/consumers/fraud-detection.consumer.spec.ts`

Tests fraud event handling and alert-generation behavior.

---

## Integration Tests

### Transaction Manager
`test/integration/transaction-manager.integration.spec.ts`

Validates transactional execution, outbox persistence, and Redis lock behavior.

### Outbox Relay
`test/integration/outbox-relay.integration.spec.ts`

Checks relay batching and concurrent cron execution behavior for unpublished outbox rows.

### Saga Recovery
`test/integration/saga-recovery.integration.spec.ts`

Exercises the current recovery implementation:
- stale `DEBITED` sagas are resumed
- stale non-`DEBITED` sagas are ignored
- recently updated `DEBITED` sagas are ignored
- concurrent manual recovery triggers do not double-credit

The integration suite calls `processStuckSagas()` directly because the cron wrapper is skipped in `NODE_ENV=test`.

### Reliability
`test/integration/reliability.integration.spec.ts`

Uses the shared test app to simulate a transfer stuck in `DEBITED` and verifies that manual recovery completes it.

### Rate Limiting
`test/integration/rate-limiting.integration.spec.ts`

Checks throttler responses, headers, and request limiting behavior against the current app bootstrap.

### Exception Filters
`test/integration/exception-filters.integration.spec.ts`

Validates HTTP error semantics and response formatting for business and validation errors.

### Wallet Caching
`test/integration/wallet.caching.integration.spec.ts`

Checks Redis-backed balance cache reads and cache updates after wallet mutations.

### Event Immutability
`test/integration/event-immutability.integration.spec.ts`

Verifies that persisted `wallet_events` rows cannot be updated or deleted.

---

## API E2E Tests

### Wallet API
`test/e2e/wallet.e2e-spec.ts`

Exercises the current API test bootstrap for deposits, withdrawals, transfers, idempotency, and history queries.

### Health Endpoint
`test/e2e/health.e2e-spec.ts`

Checks the health endpoint exposed by the current test bootstrap and validates database health details.

### Worker Boot
`test/e2e/worker.e2e-spec.ts`

Confirms the worker module compiles successfully.

---

## Stress Tests

### Concurrency
`test/stress/concurrency.stress-spec.ts`

Focuses on correctness under concurrent request races:
- same-request-id idempotency
- bidirectional transfer contention

### Chaos
`test/stress/chaos.stress-spec.ts`

Exercises compensation, data consistency, idempotency under retries, and recovery behavior under failure.

---

## Load Tests

### k6 Script
`test/load-test.k6.js`

Runs deposit, same-wallet, and transfer scenarios with latency thresholds.

### Artillery Scenario
`test/load/load-test.yml`

Provides an additional scripted load scenario.

---

## Running Tests

```bash
npm run test
npm run test:integration
npm run test:e2e
npm run test:stress
npm run test:load
```

For faster local loops:

```bash
npm run test:e2e:quick
```

For the highest-stress API scenario:

```bash
npm run test:e2e:stress
```

---

## Test Infrastructure

### Shared App Bootstrap
`test/shared/shared-test-app.ts`

Provides a reusable Nest application and data source for integration and stress suites. It also exposes helpers for stopping cron jobs during tests.

### Global Jest Setup
`test/setup.ts`

Sets a longer default Jest timeout and installs `crypto.webcrypto` on `global.crypto` for Node.js 22 compatibility.

---

## Environment Notes

- Integration, API E2E, and stress suites need the application environment variables required by `AppConfigService`.
- Suites that boot the app also require the backing services they use, typically PostgreSQL, Redis, and RabbitMQ.
- Some focused regression checks can still be validated with direct Jest runs or TypeScript compilation when the full environment is unavailable.
