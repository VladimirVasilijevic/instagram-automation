import { check } from 'k6';
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import http from 'k6/http';

import { config, scenario, testEnvironment, thresholds } from './common.js';

const supportedBehaviors = new Set(['success', 'slow', 'rate-limit', 'permanent', 'timeout']);
const behavior = testEnvironment.LOAD_TEST_BEHAVIOR || 'success';
if (!supportedBehaviors.has(behavior))
  exec.test.abort(`Unsupported LOAD_TEST_BEHAVIOR: ${behavior}`);
const parsedEventsPerRequest = Number(testEnvironment.LOAD_TEST_EVENTS_PER_REQUEST || '1');
if (
  !Number.isInteger(parsedEventsPerRequest) ||
  parsedEventsPerRequest < 1 ||
  parsedEventsPerRequest > 10
) {
  exec.test.abort('LOAD_TEST_EVENTS_PER_REQUEST must be an integer from 1 through 10');
}
const duplicate = testEnvironment.LOAD_TEST_DUPLICATE === 'true';

export const options = {
  scenarios: { webhook: scenario('sendWebhook') },
  thresholds: {
    ...thresholds,
    'http_req_duration{kind:webhook}': [behavior === 'slow' ? 'p(95)<5000' : 'p(95)<2000'],
  },
};

const commentId = (eventIndex) => {
  if (duplicate) return `${config.runId}-${behavior}-duplicate-${eventIndex}`;
  return `${config.runId}-${behavior}-${exec.scenario.iterationInTest}-${eventIndex}`;
};

export function sendWebhook() {
  const changes = Array.from({ length: parsedEventsPerRequest }, (_, eventIndex) => ({
    field: 'comments',
    value: {
      from: {
        id: `${config.runId}-commenter-${eventIndex}`,
        username: `load_test_commenter_${eventIndex}`,
      },
      id: commentId(eventIndex),
      media: { id: config.mediaId },
      text: config.triggerText,
    },
  }));
  const body = JSON.stringify({
    entry: [{ changes, id: config.accountInstagramId }],
    object: 'instagram',
  });
  const signature = crypto.hmac('sha256', config.appSecret, body, 'hex');
  const response = http.post(`${config.baseUrl}/api/webhooks/instagram`, body, {
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    tags: { behavior, kind: 'webhook' },
  });
  check(response, {
    'webhook acknowledged': (result) => result.status === 200 && result.body === 'EVENT_RECEIVED',
  });
}
