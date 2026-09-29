import { check } from 'k6';
import http from 'k6/http';

import { config, scenario, thresholds } from './common.js';

const authenticated = {
  headers: { Cookie: config.sessionCookie },
  tags: { kind: 'authenticated' },
};

export const options = {
  scenarios: {
    api_health: scenario('apiHealth'),
    automation_read: scenario('automationRead'),
    database_health: scenario('databaseHealth'),
    executions_read: scenario('executionsRead'),
    invalid_webhook: scenario('invalidWebhook'),
  },
  thresholds: {
    ...thresholds,
    'http_req_duration{kind:api-health}': ['p(95)<250'],
    'http_req_duration{kind:database}': ['p(95)<750'],
    'http_req_duration{kind:authenticated}': ['p(95)<1000'],
  },
};

const status = (response, expected) =>
  check(response, { [`status is ${expected}`]: (r) => r.status === expected });

export function apiHealth() {
  status(http.get(`${config.baseUrl}/api/health`, { tags: { kind: 'api-health' } }), 200);
}

export function databaseHealth() {
  status(http.get(`${config.baseUrl}/api/health/database`, { tags: { kind: 'database' } }), 200);
}

export function automationRead() {
  status(http.get(`${config.baseUrl}/api/automation`, authenticated), 200);
}

export function executionsRead() {
  status(http.get(`${config.baseUrl}/api/executions?limit=50`, authenticated), 200);
}

export function invalidWebhook() {
  status(
    http.post(`${config.baseUrl}/api/webhooks/instagram`, '{}', {
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=invalid' },
      responseCallback: http.expectedStatuses(401),
      tags: { kind: 'invalid-webhook' },
    }),
    401,
  );
}
