import http from 'k6/http';
import { check } from 'k6';

// Configuration
const BASE_URL = __ENV.API_URL || 'http://host.docker.internal:3000';

export const options = {
  scenarios: {
    concurrent_deposits: {
      executor: 'shared-iterations',
      exec: 'concurrent_deposits',
      vus: 20,
      iterations: 1000,
      maxDuration: '1m',
      startTime: '0s',
    },
    same_wallet_ops: {
      executor: 'shared-iterations',
      exec: 'same_wallet_ops',
      vus: 10,
      iterations: 100,
      maxDuration: '30s',
      startTime: '10s', // Start after some deposits
    },
    concurrent_transfers: {
      executor: 'shared-iterations',
      exec: 'concurrent_transfers',
      vus: 10,
      iterations: 50,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // http errors should be less than 1%
    http_req_duration: ['p(95)<500'], // 95% of requests should be below 500ms
  },
};

// Setup data if needed (k6 setup function)
export function setup() {
  // Optional: Create initial wallets if needed
  // For now, we rely on the endpoints creating them or them existing
}

export default function () {
  // This default function is required but we use scenarios with specific exec functions if we want distinct logic.
  // However, k6 executes this function for all scenarios unless 'exec' is specified.
  // Let's use specific functions for clarity.
}

// Scenario 1: Concurrent deposits to different wallets
export function concurrent_deposits() {
  const id = __VU * 1000 + __ITER;
  const payload = JSON.stringify({ amount: 100 });
  const params = {
    headers: requestHeaders(`k6-deposit-${id}`),
  };

  const res = http.post(`${BASE_URL}/v1/wallet/user-${id}/deposit`, payload, params);
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}

// Scenario 2: Concurrent operations on same wallet
export function same_wallet_ops() {
  // First ensure wallet has funds (only once per VU or just try withdraw)
  // To match original logic: "First, deposit enough funds". 
  // In k6, it's harder to do "once global". We can just deposit before withdraw in each iter or assume setup.
  // Let's just deposit 100 then withdraw 10.
  
  const walletId = 'load-test-user';
  const depositParams = {
    headers: requestHeaders(`k6-same-wallet-deposit-${__VU}-${__ITER}`),
  };
  const withdrawParams = {
    headers: requestHeaders(`k6-same-wallet-withdraw-${__VU}-${__ITER}`),
  };

  // Deposit
  http.post(
    `${BASE_URL}/v1/wallet/${walletId}/deposit`,
    JSON.stringify({ amount: 100 }),
    depositParams,
  );

  // Withdraw
  const res = http.post(
    `${BASE_URL}/v1/wallet/${walletId}/withdraw`,
    JSON.stringify({ amount: 10 }),
    withdrawParams,
  );
  
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}

// Scenario 3: Concurrent transfers
export function concurrent_transfers() {
  const id = __VU * 100 + __ITER;
  const senderId = `sender-${id}`;
  const receiverId = `receiver-${id}`;
  const fundingParams = {
    headers: requestHeaders(`k6-transfer-deposit-${id}`),
  };
  const transferParams = {
    headers: requestHeaders(`k6-transfer-${id}`),
  };

  // Setup sender
  http.post(
    `${BASE_URL}/v1/wallet/${senderId}/deposit`,
    JSON.stringify({ amount: 1000 }),
    fundingParams,
  );

  // Transfer
  const payload = JSON.stringify({ toWalletId: receiverId, amount: 50 });
  const res = http.post(`${BASE_URL}/v1/wallet/${senderId}/transfer`, payload, transferParams);

  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}

function requestHeaders(requestId) {
  return {
    'Content-Type': 'application/json',
    'x-request-id': requestId,
    'x-forwarded-for': clientIp(__VU, __ITER),
  };
}

function clientIp(vu, iter) {
  const a = 10 + (vu % 200);
  const b = Math.floor(iter / 250) % 255;
  const c = (iter % 250) + 1;
  return `10.${a}.${b}.${c}`;
}
