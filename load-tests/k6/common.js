import exec from 'k6/execution';

const environment = globalThis.__ENV;

export const config = JSON.parse(globalThis.open('../.generated/config.json'));
if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(config.baseUrl)) {
  exec.test.abort('Generated configuration must target the local load-test server');
}

const profiles = {
  smoke: {
    executor: 'constant-arrival-rate',
    duration: '15s',
    rate: 1,
    timeUnit: '1s',
    preAllocatedVUs: 2,
    maxVUs: 10,
  },
  average: {
    executor: 'constant-arrival-rate',
    duration: '5m',
    rate: 5,
    timeUnit: '1s',
    preAllocatedVUs: 10,
    maxVUs: 50,
  },
  discovery: {
    executor: 'ramping-arrival-rate',
    startRate: 1,
    timeUnit: '1s',
    preAllocatedVUs: 20,
    maxVUs: 150,
    stages: [
      { duration: '30s', target: 1 },
      { duration: '1m', target: 5 },
      { duration: '1m', target: 10 },
      { duration: '1m', target: 25 },
      { duration: '30s', target: 0 },
    ],
  },
  spike: {
    executor: 'ramping-arrival-rate',
    startRate: 1,
    timeUnit: '1s',
    preAllocatedVUs: 25,
    maxVUs: 150,
    stages: [
      { duration: '15s', target: 1 },
      { duration: '10s', target: 25 },
      { duration: '30s', target: 25 },
      { duration: '15s', target: 0 },
    ],
  },
  soak: {
    executor: 'constant-arrival-rate',
    duration: '30m',
    rate: 5,
    timeUnit: '1s',
    preAllocatedVUs: 10,
    maxVUs: 50,
  },
};

export const selectedProfile = () => {
  const name = environment.LOAD_PROFILE || 'smoke';
  const profile = profiles[name];
  if (!profile) exec.test.abort(`Unsupported LOAD_PROFILE: ${name}`);
  return profile;
};

export const scenario = (execName) => ({ ...selectedProfile(), exec: execName });

export const thresholds = {
  checks: ['rate>0.99'],
  dropped_iterations: ['count==0'],
  http_req_failed: ['rate<0.01'],
};

export const testEnvironment = environment;
