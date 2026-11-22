import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';

import { serve } from '@hono/node-server';
import type {
  SocialContentKind,
  SocialMediaItem,
  SocialProvider,
} from '@instagram-automation/contracts';
import postgres from 'postgres';

import { createApp } from '../../src/app.js';
import { processFacebookComment } from '../../src/automation/process-facebook-comment.js';
import { processFacebookMessage } from '../../src/automation/process-facebook-message.js';
import { createDatabase } from '../../src/database/database.js';
import type { SaveAutomationInput } from '../../src/database/repositories.js';
import { AesGcmTokenProtector } from '../../src/security/aes-gcm-token-protector.js';
import { createSessionToken } from '../../src/security/session-token.js';
import {
  knownApplicationDatabaseUrls,
  loadTestAppSecret,
  loadTestEncryptionKey,
  loadTestSessionCookieName,
  requireIsolatedLoadTestDatabase,
} from './config.js';
import { settleThenCleanup } from './lifecycle.js';
import { createFakeMeta, fakeStatus, verifyExactEvidence, type FakeDispatch } from './fake-meta.js';

interface Rule {
  item: SocialMediaItem;
  input: SaveAutomationInput;
}
interface Actor {
  provider: SocialProvider;
  externalId: string;
  userId: string;
  connectionId: string;
  token: string;
  cookie: string;
  rules: Rule[];
}
interface Timing {
  label: string;
  ms: number;
  failed: boolean;
  phase: string;
}
const ownerPayload = (input: SaveAutomationInput) => ({
  mediaId: input.mediaId,
  enabled: input.enabled,
  deliveryMode: input.deliveryMode,
  triggerMode: input.triggerMode,
  triggerText: input.triggerText,
  replyText: input.replyText,
  privateReplyText: input.privateReplyText,
  quickReplyOptions: input.quickReplyOptions ?? [],
});
const profiles = {
  smoke: [{ seconds: 15, rate: 1 }],
  mixed: [
    { seconds: 25, rate: 1 },
    { seconds: 25, rate: 5 },
    { seconds: 25, rate: 10 },
  ],
  duplicate: [
    { seconds: 10, rate: 1 },
    { seconds: 20, rate: 10 },
  ],
} as const;

/** Runs bounded open-loop HTTP arrivals against loopback with mocked Meta and exact durable evidence. */
export const runHttpLoadSuite = async (): Promise<void> => {
  const profileName = process.env.LOAD_PROFILE ?? 'smoke';
  assert(profileName in profiles, 'LOAD_PROFILE must be smoke, mixed, or duplicate');
  const profile = profiles[profileName as keyof typeof profiles];
  const url = requireIsolatedLoadTestDatabase(
    process.env.LOAD_TEST_DATABASE_URL,
    process.env.LOAD_TEST_CONFIRM_ISOLATED,
    knownApplicationDatabaseUrls(),
  );
  const database = createDatabase(url);
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
  const protector = new AesGcmTokenProtector(loadTestEncryptionKey);
  const runId = `http-${randomUUID().slice(0, 8)}`;
  const actors: Actor[] = [];
  const owners: string[] = [];
  const credentials = new Map<string, { owner: string; provider: string }>();
  const fake = createFakeMeta(credentials, 75);
  const expectedDispatch = new Map<string, FakeDispatch>();
  const expectedExecution = new Map<string, FakeDispatch>();
  const expectedFollowup = new Map<string, FakeDispatch>();
  const timings: Timing[] = [];
  const logCounts: Record<string, number> = {};
  const logger = {
    info: (message: string) => {
      logCounts[message] = (logCounts[message] ?? 0) + 1;
    },
    error: (message: string) => {
      logCounts[message] = (logCounts[message] ?? 0) + 1;
    },
  };
  let server: ReturnType<typeof serve> | undefined;
  let baseUrl = '';
  let phase = 'preflight';
  let completed = 0;
  let dropped = 0;
  let late = 0;
  let maxInflight = 0;
  const active = new Set<Promise<void>>();
  const handlers = new Set<Promise<Response>>();
  const failures: string[] = [];
  const request = async (label: string, path: string, init: RequestInit = {}, status = 200) => {
    const start = performance.now();
    let failed = true;
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.text();
      assert.equal(response.status, status, `${label}: unexpected HTTP status`);
      failed = false;
      return body;
    } finally {
      timings.push({ label, ms: performance.now() - start, failed, phase });
    }
  };
  const signed = (actor: Actor, payload: unknown, valid = true) => {
    const body = JSON.stringify(payload);
    return request(
      `${actor.provider}:${body.includes('"reply_to"') ? 'story' : body.includes('"messaging"') ? 'answer' : 'comment'}`,
      `/api/webhooks/${actor.provider}`,
      {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${valid ? createHmac('sha256', loadTestAppSecret).update(body).digest('hex') : '0'.repeat(64)}`,
        },
      },
      valid ? 200 : 401,
    );
  };
  const messaging = (
    actor: Actor,
    id: string,
    sender: string,
    message: Record<string, unknown>,
  ) => ({
    object: actor.provider === 'instagram' ? 'instagram' : 'page',
    entry: [
      {
        id: actor.externalId,
        messaging: [
          {
            sender: { id: sender },
            recipient: { id: actor.externalId },
            timestamp: Date.now() - 1000,
            message: { mid: id, text: '#LoadTest', ...message },
          },
        ],
      },
    ],
  });
  const envelope = (actor: Actor, rule: Rule, ids: string[]) =>
    rule.item.contentKind === 'story'
      ? {
          object: 'instagram',
          entry: [
            {
              id: actor.externalId,
              messaging: ids.map((id) => ({
                sender: { id: `sender-${id}` },
                recipient: { id: actor.externalId },
                timestamp: Date.now() - 1000,
                message: { mid: id, text: '#LoadTest', reply_to: { story: { id: rule.item.id } } },
              })),
            },
          ],
        }
      : {
          object: actor.provider === 'instagram' ? 'instagram' : 'page',
          entry: [
            {
              id: actor.externalId,
              changes: ids.map((id) =>
                actor.provider === 'instagram'
                  ? {
                      field: 'comments',
                      value: {
                        id,
                        from: { id: 'synthetic-buyer', username: 'buyer' },
                        media: { id: rule.item.id },
                        text: '#LoadTest',
                      },
                    }
                  : {
                      field: 'feed',
                      value: {
                        item: 'comment',
                        verb: 'add',
                        comment_id: id,
                        post_id: rule.item.id,
                        from: { id: 'synthetic-buyer', name: 'Buyer' },
                        message: '#LoadTest',
                      },
                    },
              ),
            },
          ],
        };
  const expectEvent = (actor: Actor, rule: Rule, id: string) => {
    if (!rule.input.enabled) return;
    const channels =
      rule.input.deliveryMode === 'both' ? ['public', 'private'] : [rule.input.deliveryMode];
    for (const channel of channels) {
      const text = channel === 'public' ? rule.input.replyText : rule.input.privateReplyText!;
      const execKey = `${actor.connectionId}|${rule.item.id}|${id}|${channel}`;
      expectedExecution.set(execKey, {
        key: execKey,
        message: `${rule.item.id}|${fakeStatus(id)}|${text}`,
      });
      const dispatchKey = `${actor.externalId}|${rule.item.contentKind === 'story' ? `sender-${id}|direct` : `${id}|${channel}`}`;
      const key = `${dispatchKey}|${text}`;
      expectedDispatch.set(key, { key, message: text });
    }
  };
  const sendEvent = async (actor: Actor, rule: Rule, ids: string[], withFollowup = false) => {
    for (const id of ids) expectEvent(actor, rule, id);
    assert.equal(await signed(actor, envelope(actor, rule, ids)), 'EVENT_RECEIVED');
    if (withFollowup && rule.input.deliveryMode !== 'public' && rule.input.enabled) {
      const id = ids[0]!;
      const story = rule.item.contentKind === 'story';
      const initialKey = `${actor.externalId}|${story ? `sender-${id}|direct` : `${id}|private`}`;
      const payload = fake.choices.get(initialKey);
      assert(payload, 'Private delivery failed to offer a quick reply');
      const recipient = story ? `sender-${id}` : `recipient-${id}`;
      const followupText = rule.input.quickReplyOptions![0]!.followUpText;
      const directKey = `${actor.externalId}|${recipient}|direct|${followupText}`;
      expectedDispatch.set(directKey, { key: directKey, message: followupText });
      const followupKey = `${actor.connectionId}|${recipient}`;
      expectedFollowup.set(followupKey, { key: followupKey, message: followupText });
      // Repeated answer delivery must not start a second follow-up.
      const answer = messaging(actor, `answer-${id}`, recipient, { quick_reply: { payload } });
      await Promise.all([signed(actor, answer), signed(actor, answer)]);
    }
  };
  try {
    for (const provider of ['instagram', 'facebook'] as const)
      for (let tenant = 0; tenant < 2; tenant += 1) {
        const externalId = `${runId}-${provider}-${tenant}`;
        const token = `synthetic-token-${externalId}`;
        let userId: string;
        let connectionId: string;
        if (provider === 'instagram') {
          const identity = await database.identityRepository.completeInstagramLogin({
            instagramUserId: externalId,
            username: `buyer_${tenant}`,
            accessTokenCiphertext: protector.encrypt(token),
            tokenExpiresAt: new Date(Date.now() + 86_400_000),
          });
          userId = identity.user.id;
          connectionId = identity.connection.id;
        } else {
          const user = await database.identityRepository.completeSignIn({
            provider,
            externalUserId: externalId,
            displayName: 'Synthetic owner',
          });
          userId = user.id;
          owners.push(userId);
          const connection = await database.socialConnectionRepository.connectFacebookPage({
            userId,
            pageId: externalId,
            pageName: 'Synthetic Page',
            accessTokenCiphertext: protector.encrypt(token),
          });
          connectionId = connection.id;
        }
        if (!owners.includes(userId)) owners.push(userId);
        credentials.set(token, { owner: externalId, provider });
        const session = createSessionToken();
        await database.sessionRepository.createSession({
          userId,
          tokenHash: session.tokenHash,
          expiresAt: new Date(Date.now() + 86_400_000),
        });
        const actor: Actor = {
          provider,
          externalId,
          userId,
          connectionId,
          token,
          cookie: `${loadTestSessionCookieName}=${session.token}`,
          rules: [],
        };
        actors.push(actor);
        const kinds: SocialContentKind[] =
          provider === 'instagram' ? ['post', 'reel', 'story', 'post'] : ['post', 'post', 'post'];
        for (let index = 0; index < kinds.length; index += 1) {
          const kind = kinds[index]!;
          const mediaId = `${externalId}-${kind}-${index}`;
          const deliveryMode = kind === 'story' ? 'private' : index === 0 ? 'public' : 'both';
          const input: SaveAutomationInput = {
            accountId: connectionId,
            mediaId,
            deliveryMode,
            triggerKind: kind === 'story' ? 'story_reply' : 'comment',
            enabled: index !== kinds.length - 1,
            triggerMode: 'exact',
            triggerText: '#LoadTest',
            replyText: deliveryMode === 'private' ? '' : `${mediaId}-public`,
            privateReplyText: deliveryMode === 'public' ? null : `${mediaId}-private`,
            quickReplyOptions:
              deliveryMode === 'public'
                ? []
                : [{ id: randomUUID(), title: 'Yes', followUpText: `${mediaId}-followup` }],
          };
          await database.automationRepository.saveAutomation(input);
          actor.rules.push({
            input,
            item: {
              id: mediaId,
              caption: `Synthetic ${kind}`,
              contentKind: kind,
              mediaType: kind === 'post' ? 'IMAGE' : 'VIDEO',
              mediaUrl: null,
              thumbnailUrl: null,
              timestamp: new Date().toISOString(),
              permalink: null,
            },
          });
        }
      }
    const actorFor = (externalId: string) => {
      const actor = actors.find((item) => item.externalId === externalId);
      assert(actor, 'Unknown catalog owner');
      return actor;
    };
    const page = (externalId: string, limit: number, after: string | undefined, story: boolean) => {
      const items = actorFor(externalId)
        .rules.filter((rule) => (rule.item.contentKind === 'story') === story)
        .map((rule) => rule.item);
      const start = after ? Number(after) : 0;
      assert(Number.isInteger(start) && start >= 0, 'Invalid synthetic cursor');
      return {
        media: items.slice(start, start + limit),
        after: start + limit < items.length ? String(start + limit) : null,
      };
    };
    const instagramMediaClient = {
      listRecentMedia: async (input: { instagramUserId: string; limit: number }) =>
        page(input.instagramUserId, input.limit, undefined, false).media,
      listMediaPage: async (input: { instagramUserId: string; limit: number; after?: string }) =>
        page(input.instagramUserId, input.limit, input.after, false),
      listStoriesPage: async (input: { instagramUserId: string; limit: number; after?: string }) =>
        page(input.instagramUserId, input.limit, input.after, true),
      findOwnedMedia: async (input: { instagramUserId: string; mediaId: string }) =>
        actorFor(input.instagramUserId).rules.find((rule) => rule.item.id === input.mediaId)
          ?.item ?? null,
    };
    const facebookPageClient = {
      listManagedPages: async () => [],
      listRecentPosts: async () => [],
      listPostPage: async (input: { pageId: string; limit: number; after?: string }) =>
        page(input.pageId, input.limit, input.after, false),
      findOwnedPost: async (input: { pageId: string; mediaId: string }) =>
        actorFor(input.pageId).rules.find((rule) => rule.item.id === input.mediaId)?.item ?? null,
      subscribeToEvents: async () => undefined,
    };
    const shared = {
      automationRepository: database.automationRepository,
      executionRepository: database.executionRepository,
      tokenRefreshRepository: database.tokenRefreshRepository,
      tokenProtector: protector,
      logger,
      ...fake,
    };
    const app = createApp({
      database,
      automationRepository: database.automationRepository,
      executionRepository: database.executionRepository,
      dmConversationRepository: database.dmConversationRepository,
      sessionRepository: database.sessionRepository,
      sessionCookie: { name: loadTestSessionCookieName, secure: false, ttlSeconds: 86_400 },
      logger,
      docsEnabled: false,
      instagramAuth: {
        identityRepository: database.identityRepository,
        appBaseUrl: 'http://127.0.0.1',
        redirectUri: 'http://127.0.0.1/api/auth/instagram/callback',
        tokenProtector: protector,
        oauthStateRepository: database.oauthStateRepository,
        instagramClient: {
          authorizationUrl: () => 'https://invalid.load-test.local',
          completeLogin: async () => {
            throw new Error('OAuth disabled');
          },
        },
      },
      instagramMedia: { instagramMediaClient, tokenProtector: protector },
      instagramSubscription: {
        instagramWebhookClient: { subscribeToComments: async () => undefined },
        tokenRefreshRepository: database.tokenRefreshRepository,
      },
      instagramWebhook: {
        accountRepository: database.accountRepository,
        appSecret: loadTestAppSecret,
        verifyToken: 'synthetic-verify',
        tokenProtector: protector,
        ...fake,
        dmConversationRepository: database.dmConversationRepository,
      },
      facebookPage: {
        facebookPageClient,
        socialConnectionRepository: database.socialConnectionRepository,
      },
      facebookWebhook: {
        appSecret: loadTestAppSecret,
        verifyToken: 'synthetic-verify',
        processFacebookComment: async (event) => {
          await processFacebookComment(event, {
            ...shared,
            socialConnectionRepository: database.socialConnectionRepository,
          });
        },
        processFacebookMessage: async (event) => {
          await processFacebookMessage(event, {
            ...shared,
            socialConnectionRepository: database.socialConnectionRepository,
            dmConversationRepository: database.dmConversationRepository,
          });
        },
      },
    });
    console.info(`Prepared four synthetic connections for ${runId}`);
    server = serve({
      fetch: (request) => {
        const handling = Promise.resolve(app.fetch(request));
        handlers.add(handling);
        void handling.then(
          () => handlers.delete(handling),
          () => handlers.delete(handling),
        );
        return handling;
      },
      hostname: '127.0.0.1',
      port: 0,
    });
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
    // Catalog, exact rule reads/saves, Story-only policy and tenant ownership use real HTTP middleware.
    for (const actor of actors) {
      const headers = { cookie: actor.cookie, 'content-type': 'application/json' };
      const list = JSON.parse(await request('rules:list', '/api/automation', { headers })) as {
        automations: { mediaId: string }[];
      };
      assert.deepEqual(
        list.automations.map((rule) => rule.mediaId).sort(),
        actor.rules.map((rule) => rule.item.id).sort(),
        'Rule list crossed owner boundary',
      );
      assert.equal(list.automations.length, actor.rules.length);
      const first = actor.rules[0]!;
      const exact = JSON.parse(
        await request(
          'rules:exact',
          `/api/automation?mediaId=${encodeURIComponent(first.item.id)}`,
          { headers },
        ),
      ) as { automation: { mediaId: string } };
      assert.equal(exact.automation.mediaId, first.item.id);
      const input = ownerPayload(first.input);
      const saved = JSON.parse(
        await request('rules:save', '/api/automation', {
          method: 'PUT',
          headers,
          body: JSON.stringify(input),
        }),
      ) as { automation: { mediaId: string } };
      assert.equal(saved.automation.mediaId, first.item.id);
      const other = actors.find((item) => item.provider === actor.provider && item !== actor)!;
      const hidden = JSON.parse(
        await request(
          'rules:foreign-read',
          `/api/automation?mediaId=${encodeURIComponent(other.rules[0]!.item.id)}`,
          { headers },
        ),
      ) as { automation: unknown };
      assert.equal(hidden.automation, null);
      await request(
        'rules:foreign-save',
        '/api/automation',
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...input, mediaId: other.rules[0]!.item.id }),
        },
        400,
      );
      const catalog = JSON.parse(
        await request('catalog:first', '/api/media?kind=post&limit=1', { headers }),
      ) as { media: { id: string }[]; nextCursor: string | null };
      assert.equal(catalog.media[0]?.id, first.item.id);
      assert(catalog.nextCursor, 'Catalog fixture must exercise continuation');
      await request(
        'catalog:next',
        `/api/media?kind=post&limit=1&cursor=${encodeURIComponent(catalog.nextCursor)}`,
        { headers },
      );
      await request(
        'catalog:cross-category',
        `/api/media?kind=story&cursor=${encodeURIComponent(catalog.nextCursor)}`,
        { headers },
        actor.provider === 'facebook' ? 409 : 400,
      );
      await request(
        'catalog:story',
        '/api/media?kind=story',
        { headers },
        actor.provider === 'instagram' ? 200 : 409,
      );
      await request(
        'catalog:reel',
        '/api/media?kind=reel',
        { headers },
        actor.provider === 'instagram' ? 200 : 409,
      );
      assert.equal(
        await request(
          'webhook:challenge',
          `/api/webhooks/${actor.provider}?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=challenge`,
        ),
        'challenge',
      );
      if (actor.provider === 'instagram') {
        const storyInput = ownerPayload(actor.rules[2]!.input);
        await request(
          'rules:story-public-forbidden',
          '/api/automation',
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              ...storyInput,
              deliveryMode: 'both',
              replyText: 'Forbidden public reply',
            }),
          },
          400,
        );
        const savedStory = JSON.parse(
          await request('rules:story-save', '/api/automation', {
            method: 'PUT',
            headers,
            body: JSON.stringify(storyInput),
          }),
        ) as { automation: { triggerKind: string } };
        assert.equal(savedStory.automation.triggerKind, 'story_reply');
      }
      await signed(actor, envelope(actor, first, ['bad-signature']), false);
      await signed(
        actor,
        envelope(actor, { ...first, item: { ...first.item, id: 'unknown-media' } }, [
          'unknown-event',
        ]),
      );
      await signed(actor, envelope(actor, actor.rules.at(-1)!, ['disabled-event']));
      await sendEvent(actor, first, ['same-media-event']);
      await sendEvent(actor, actor.rules[1]!, ['same-media-event']);
      const followupRule = actor.rules[1]!;
      await sendEvent(actor, followupRule, ['shared-followup-event'], true);
      // Duplicate parent comment deliveries and failure states across both providers.
      for (const behavior of ['slow', 'rate-limit', 'permanent', 'timeout']) {
        await sendEvent(actor, followupRule, [`matrix-${behavior}-one`]);
      }
      if (actor.provider === 'instagram')
        await sendEvent(actor, actor.rules[2]!, ['story-followup-event'], true);
    }
    console.info(
      `HTTP preflight correctness passed for ${runId}; starting ${profileName} arrivals`,
    );
    const work = actors.flatMap((actor) =>
      actor.rules.filter((rule) => rule.input.enabled).map((rule) => ({ actor, rule })),
    );
    phase = 'load';
    const started = performance.now();
    let scheduledAt = started;
    let iteration = 0;
    for (const stage of profile)
      for (let index = 0; index < stage.seconds * stage.rate; index += 1) {
        await delay(Math.max(0, scheduledAt - performance.now()));
        if (performance.now() - scheduledAt > 100) late += 1;
        scheduledAt += 1000 / stage.rate;
        if (active.size >= 20) {
          dropped += 1;
          continue;
        }
        const selected = work[iteration % work.length]!;
        const id =
          profileName === 'duplicate'
            ? `spike-shared-${iteration % 2}-${selected.rule.item.id}`
            : `load-${iteration}`;
        const batch = iteration % 7 === 0 ? [id, `${id}-batch`] : [id];
        const task = sendEvent(selected.actor, selected.rule, batch)
          .then(() => {
            completed += 1;
          })
          .catch((error) => {
            failures.push(error instanceof Error ? error.message : 'Unknown request failure');
          })
          .finally(() => {
            active.delete(task);
          });
        active.add(task);
        maxInflight = Math.max(maxInflight, active.size);
        iteration += 1;
      }
    await Promise.allSettled([...active]);
    const elapsedMs = Math.round(performance.now() - started);
    assert(completed > 0, 'Zero measured HTTP work is invalid');
    assert.equal(failures.length, 0, 'HTTP scenario failed');
    const ids = actors.map((actor) => actor.connectionId);
    const rows = await sql<
      {
        connection_id: string;
        instagram_comment_id: string;
        delivery_channel: string;
        media_id: string;
        status: string;
        message_text: string;
      }[]
    >`select a.connection_id,e.instagram_comment_id,e.delivery_channel,e.media_id,e.status,e.message_text from app_private.executions e join app_private.automations a on a.id=e.automation_id where a.connection_id = any(${ids}::uuid[])`;
    const actualExecution = rows.map((row) => ({
      key: `${row.connection_id}|${row.media_id}|${row.instagram_comment_id}|${row.delivery_channel}`,
      message: `${row.media_id}|${row.status}|${row.message_text}`,
    }));
    verifyExactEvidence([...expectedExecution.values()], actualExecution);
    verifyExactEvidence([...expectedDispatch.values()], fake.dispatches);
    const followups = await sql<
      { connection_id: string; recipient_igsid: string; message_text: string; status: string }[]
    >`select connection_id,recipient_igsid,message_text,status from app_private.dm_followups where connection_id = any(${ids}::uuid[])`;
    verifyExactEvidence(
      [...expectedFollowup.values()],
      followups.map((row) => {
        assert.equal(row.status, 'succeeded');
        return { key: `${row.connection_id}|${row.recipient_igsid}`, message: row.message_text };
      }),
    );
    const answers = await sql<
      { count: number }[]
    >`select count(*)::integer as count from app_private.inbound_dm_answers where connection_id = any(${ids}::uuid[])`;
    assert.equal(answers[0]?.count, expectedFollowup.size, 'Repeated answer persisted twice');
    const groups = Object.fromEntries(
      [...new Set(timings.filter((item) => item.phase === 'load').map((item) => item.label))].map(
        (label) => {
          const values = timings
            .filter((item) => item.phase === 'load' && item.label === label)
            .map((item) => item.ms)
            .sort((a, b) => a - b);
          return [
            label,
            {
              count: values.length,
              p95Ms: Math.round(values[Math.ceil(values.length * 0.95) - 1] ?? 0),
              maxMs: Math.round(values.at(-1) ?? 0),
            },
          ];
        },
      ),
    );
    const performanceThresholds = {
      droppedArrivalsZero: dropped === 0,
      httpFailuresZero: timings.every((item) => !item.failed),
      webhookP95Under2Seconds: Object.values(groups).every((value) => value.p95Ms < 2000),
    };
    const report = {
      runId,
      profile: profileName,
      measuredWorkload: 'signed-webhook-only',
      preflight:
        'catalog/rule ownership and save, reply-mode policy, provider failures, inbound quick-reply follow-ups',
      scheduledArrivals: iteration + dropped,
      completed,
      dropped,
      lateOver100Ms: late,
      maxInflight,
      elapsedMs,
      requests: timings.length,
      preflightRequests: timings.filter((item) => item.phase === 'preflight').length,
      measuredRequests: timings.filter((item) => item.phase === 'load').length,
      httpFailures: timings.filter((item) => item.failed).length,
      exactExecutions: rows.length,
      fakeDispatches: fake.dispatches.length,
      followups: followups.length,
      correctness: 'passed',
      performance: Object.values(performanceThresholds).every(Boolean) ? 'passed' : 'failed',
      performanceThresholds,
      logCounts,
      groups,
    };
    const directory = resolve(import.meta.dirname, '../../../../load-tests/.generated');
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `http-${profileName}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.info(JSON.stringify(report, null, 2));
    // Provisional performance thresholds are reported separately from durable correctness.
    assert.equal(dropped, 0, 'Dropped HTTP arrivals exceed threshold');
    assert.equal(report.httpFailures, 0, 'HTTP failure threshold');
  } catch (error) {
    const failedReport = {
      runId,
      profile: profileName,
      result: 'failed',
      completed,
      dropped,
      maxInflight,
      requests: timings.length,
      httpFailures: timings.filter((item) => item.failed).length,
      fakeDispatches: fake.dispatches.length,
      expectedExecutions: expectedExecution.size,
      failures: failures.length,
    };
    const directory = resolve(import.meta.dirname, '../../../../load-tests/.generated');
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `http-${profileName}-failed.json`),
      `${JSON.stringify(failedReport, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.info(JSON.stringify(failedReport));
    throw error;
  } finally {
    // All requests settle before closing the listener or removing their referenced rows.
    await Promise.allSettled([...active]);
    await settleThenCleanup(handlers, async () => {
      try {
        if (server)
          await new Promise<void>((done, reject) => {
            server!.close((error) => (error ? reject(error) : done()));
            if ('closeIdleConnections' in server!) server!.closeIdleConnections();
          });
        if (owners.length)
          await sql.begin(async (tx) => {
            const userIds = owners;
            const connectionRows = await tx<
              { id: string }[]
            >`select id from app_private.social_connections where user_id = any(${owners}::uuid[])`;
            const connectionIds = connectionRows.map((row) => row.id);
            if (connectionIds.length) {
              const ids = connectionIds;
              await tx`delete from app_private.dm_followups where connection_id = any(${ids}::uuid[])`;
              await tx`delete from app_private.inbound_dm_answers where connection_id = any(${ids}::uuid[])`;
              await tx`delete from app_private.executions where automation_id in (select id from app_private.automations where connection_id = any(${ids}::uuid[]))`;
              await tx`delete from app_private.automations where connection_id = any(${ids}::uuid[])`;
              await tx`delete from app_private.facebook_pages where connection_id = any(${ids}::uuid[])`;
            }
            await tx`delete from app_private.sessions where user_id = any(${userIds}::uuid[])`;
            await tx`delete from app_private.instagram_accounts where id in (select id from app_private.social_connections where user_id = any(${userIds}::uuid[]))`;
            await tx`delete from app_private.social_connections where user_id = any(${userIds}::uuid[])`;
            await tx`delete from app_private.login_identities where user_id = any(${userIds}::uuid[])`;
            await tx`delete from app_private.users where id = any(${userIds}::uuid[])`;
          });
        if (owners.length) {
          const remaining = await sql<
            { count: number }[]
          >`select count(*)::integer as count from app_private.users where id = any(${owners}::uuid[])`;
          assert.equal(remaining[0]?.count, 0, 'Synthetic fixture cleanup incomplete');
        }
      } finally {
        await database.close();
        await sql.end({ timeout: 5 });
      }
    });
    console.info(`Removed exact fixtures for ${runId}`);
  }
};
