'use strict';

const { randomUUID } = require('node:crypto');

let scenarioCounter = 0;

module.exports = {
  initDepositFlow,
  initWithdrawalFlow,
  initTransferFlow,
  initBalanceCheckFlow,
  prepareDepositRequest,
  prepareWithdrawalFundingRequest,
  prepareWithdrawalRequest,
  prepareTransferFundingRequest,
  prepareTransferRequest,
  prepareBalanceCheckRequest,
};

function initDepositFlow(context, _events, done) {
  context.vars.walletId = `load-user-${scenarioCounter++}`;
  context.vars.clientIp = nextClientIp();
  context.vars.depositAmount = randomInt(10, 1000);
  done();
}

function initWithdrawalFlow(context, _events, done) {
  context.vars.walletId = `load-withdraw-${scenarioCounter++}`;
  context.vars.clientIp = nextClientIp();
  context.vars.depositAmount = 500;
  context.vars.withdrawAmount = randomInt(10, 100);
  done();
}

function initTransferFlow(context, _events, done) {
  context.vars.senderId = `load-sender-${scenarioCounter++}`;
  context.vars.receiverId = `load-receiver-${scenarioCounter++}`;
  context.vars.clientIp = nextClientIp();
  context.vars.depositAmount = 1000;
  context.vars.transferAmount = randomInt(10, 100);
  done();
}

function initBalanceCheckFlow(context, _events, done) {
  context.vars.walletId = `load-balance-${scenarioCounter++}`;
  context.vars.clientIp = nextClientIp();
  done();
}

function prepareDepositRequest(requestParams, context, _events, done) {
  requestParams.json = { amount: context.vars.depositAmount };
  requestParams.headers = writeHeaders(context.vars.clientIp, 'load-deposit');
  done();
}

function prepareWithdrawalFundingRequest(requestParams, context, _events, done) {
  requestParams.json = { amount: context.vars.depositAmount };
  requestParams.headers = writeHeaders(context.vars.clientIp, 'load-withdraw-deposit');
  done();
}

function prepareWithdrawalRequest(requestParams, context, _events, done) {
  requestParams.json = { amount: context.vars.withdrawAmount };
  requestParams.headers = writeHeaders(context.vars.clientIp, 'load-withdraw');
  done();
}

function prepareTransferFundingRequest(requestParams, context, _events, done) {
  requestParams.json = { amount: context.vars.depositAmount };
  requestParams.headers = writeHeaders(context.vars.clientIp, 'load-transfer-deposit');
  done();
}

function prepareTransferRequest(requestParams, context, _events, done) {
  requestParams.json = {
    toWalletId: context.vars.receiverId,
    amount: context.vars.transferAmount,
  };
  requestParams.headers = writeHeaders(context.vars.clientIp, 'load-transfer');
  done();
}

function prepareBalanceCheckRequest(requestParams, context, _events, done) {
  requestParams.headers = {
    'x-forwarded-for': context.vars.clientIp,
  };
  done();
}

function writeHeaders(clientIp, requestIdPrefix) {
  return {
    'Content-Type': 'application/json',
    'x-forwarded-for': clientIp,
    'x-request-id': `${requestIdPrefix}-${randomUUID()}`,
  };
}

function nextClientIp() {
  const id = ++scenarioCounter;
  const second = Math.floor(id / 65535) % 255;
  const third = Math.floor(id / 255) % 255;
  const fourth = (id % 254) + 1;
  return `10.${second}.${third}.${fourth}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
