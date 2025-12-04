import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Configuration
const BASE_URL = __ENV.API_URL || 'http://host.docker.internal:3000';

export const options = {
  scenarios: {
    concurrent_deposits: {
      executor: 'per-vu-iterations',
      exec: 'concurrent_deposits',
      vus: 20,
      iterations: 1000, // Total 1000 deposits
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
      executor: 'per-vu-iterations',
      exec: 'concurrent_transfers',
      vus: 10,
      iterations: 50, // 10 VUs * 50 iters = 500 transfers (original was 50 total? No, loop was 50. Let's match original 50 total)
      // Original: 50 concurrent transfers. 
      // Let's do 50 iterations total with 10 VUs -> 5 iters each.
      // Wait, original was: for loop 50 times.
      // So 50 total requests.
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
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': `k6-deposit-${id}-${Date.now()}`,
    },
  };

  const res = http.post(`${BASE_URL}/wallet/user-${id}/deposit`, payload, params);
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
  const params = { headers: { 'Content-Type': 'application/json' } };

  // Deposit
  http.post(`${BASE_URL}/wallet/${walletId}/deposit`, JSON.stringify({ amount: 100 }), params);

  // Withdraw
  const res = http.post(`${BASE_URL}/wallet/${walletId}/withdraw`, JSON.stringify({ amount: 10 }), params);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}

// Scenario 3: Concurrent transfers
export function concurrent_transfers() {
  const id = __VU * 100 + __ITER;
  const senderId = `sender-${id}`;
  const receiverId = `receiver-${id}`;
  const params = { headers: { 'Content-Type': 'application/json' } };

  // Setup sender
  http.post(`${BASE_URL}/wallet/${senderId}/deposit`, JSON.stringify({ amount: 1000 }), params);

  // Transfer
  const payload = JSON.stringify({ toWalletId: receiverId, amount: 50 });
  const res = http.post(`${BASE_URL}/wallet/${senderId}/transfer`, payload, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
