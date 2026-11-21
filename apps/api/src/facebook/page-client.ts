import { z } from 'zod';

import { FacebookClientError, expectFacebookResponse, requestFacebookJson } from './http.js';

/** Page authorized by the Facebook person who completed OAuth. */
export interface FacebookManagedPage {
  /** Opaque Facebook Page ID. */
  id: string;
  /** Current Page name. */
  name: string;
  /** Server-only Page token; encrypt before persistence. */
  accessToken: string;
  /** Tasks granted to the person for this Page, when Meta supplies them. */
  tasks: string[];
}

/** Meta requires MODERATE on a Page to publish a comment reply. */
export const hasFacebookCommentTask = (page: Pick<FacebookManagedPage, 'tasks'>): boolean =>
  page.tasks.includes('MODERATE');

/** Meta requires MESSAGING on a Page to receive Messenger events. */
export const hasFacebookMessagingTask = (page: Pick<FacebookManagedPage, 'tasks'>): boolean =>
  page.tasks.includes('MESSAGING');

/** Facebook Page post eligible for a selected-post automation. */
export interface FacebookPagePost {
  /** Opaque Page post ID. */
  id: string;
  /** Post text, when available. */
  message: string | null;
  /** Public link to the post, when Meta supplies one. */
  permalinkUrl: string | null;
}

/** Page discovery and webhook subscription capabilities. */
export interface FacebookPageClient {
  /** Lists authorized Pages using the Facebook person's user token. */
  listManagedPages(userAccessToken: string): Promise<FacebookManagedPage[]>;
  /** Lists recent posts owned by one connected Page. */
  listRecentPosts(input: {
    /** Connected Page ID. */
    pageId: string;
    /** Decrypted Page token. */
    pageAccessToken: string;
    /** Maximum post count from 1 through 100. */
    limit: number;
  }): Promise<FacebookPagePost[]>;
  /** Installs the app's feed and optional Messenger subscriptions on one Page. */
  subscribeToEvents(input: {
    /** Selected Page ID. */
    pageId: string;
    /** Decrypted Page token, used only for this request. */
    pageAccessToken: string;
    /** Whether message webhooks are needed for quick replies and follow-ups. */
    includeMessages: boolean;
  }): Promise<void>;
}

/** Versioned Graph API settings for Facebook Page operations. */
export interface FacebookPageConfig {
  /** Explicit Meta Graph API version. */
  apiVersion: string;
}

const pageSchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string().trim().min(1),
  access_token: z.string().min(1),
  tasks: z.array(z.string()).optional(),
});
const pagesSchema = z.object({
  data: z.array(pageSchema),
  paging: z
    .object({ cursors: z.object({ after: z.string().min(1).optional() }).optional() })
    .optional(),
});
const postsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      message: z.string().optional(),
      permalink_url: z.string().url().optional(),
    }),
  ),
});
const subscriptionSchema = z.object({ success: z.literal(true) });

/** Creates a Facebook Page adapter with bounded discovery pagination. */
export const createFacebookPageClient = (
  config: FacebookPageConfig,
  fetcher: typeof fetch = fetch,
): FacebookPageClient => ({
  async listManagedPages(userAccessToken) {
    const result: FacebookManagedPage[] = [];
    let after: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const url = new URL(`https://graph.facebook.com/${config.apiVersion}/me/accounts`);
      url.searchParams.set('fields', 'id,name,access_token,tasks');
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);
      const page = expectFacebookResponse(
        'list_pages',
        (value) => pagesSchema.safeParse(value),
        await requestFacebookJson(
          'list_pages',
          url,
          { method: 'GET', headers: { Authorization: `Bearer ${userAccessToken}` } },
          fetcher,
        ),
      );
      result.push(
        ...page.data.map((item) => ({
          id: item.id,
          name: item.name,
          accessToken: item.access_token,
          tasks: item.tasks ?? [],
        })),
      );
      const next = page.paging?.cursors?.after;
      if (!next || next === after || page.data.length === 0) return result;
      after = next;
    }
    throw new FacebookClientError('list_pages', 'invalid_response');
  },
  async listRecentPosts({ pageId, pageAccessToken, limit }) {
    const url = new URL(
      `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(pageId)}/feed`,
    );
    url.searchParams.set('fields', 'id,message,permalink_url');
    url.searchParams.set('limit', String(Math.max(1, Math.min(100, Math.trunc(limit)))));
    const posts = expectFacebookResponse(
      'list_page_posts',
      (value) => postsSchema.safeParse(value),
      await requestFacebookJson(
        'list_page_posts',
        url,
        { method: 'GET', headers: { Authorization: `Bearer ${pageAccessToken}` } },
        fetcher,
      ),
    );
    return posts.data.map((post) => ({
      id: post.id,
      message: post.message ?? null,
      permalinkUrl: post.permalink_url ?? null,
    }));
  },
  async subscribeToEvents({ pageId, pageAccessToken, includeMessages }) {
    const url = new URL(
      `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(pageId)}/subscribed_apps`,
    );
    const body = new URLSearchParams({
      subscribed_fields: includeMessages ? 'feed,messages' : 'feed',
    });
    expectFacebookResponse(
      'subscribe_page',
      (value) => subscriptionSchema.safeParse(value),
      await requestFacebookJson(
        'subscribe_page',
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pageAccessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body,
        },
        fetcher,
      ),
    );
  },
});
