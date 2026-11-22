import type { SocialMediaItem } from '@instagram-automation/contracts';

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
  /** Image supplied by Meta for the post attachment, when available. */
  pictureUrl: string | null;
}

/** One normalized page of posts or Reels owned by a Facebook Page. */
export interface FacebookMediaPage {
  /** Provider media items with their original identifiers. */
  media: SocialMediaItem[];
  /** Provider continuation cursor without access tokens, or null at the end. */
  after: string | null;
}

/** Credential and pagination input for a single Facebook media page. */
export interface FacebookMediaPageInput {
  /** Connected Facebook Page identifier. */
  pageId: string;
  /** Decrypted Page credential used only for the provider request. */
  pageAccessToken: string;
  /** Maximum number of items requested from this page. */
  limit: number;
  /** Provider continuation cursor from the preceding page. */
  after?: string;
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
  /** Reads a raw Page post page. */
  listPostPage?(input: FacebookMediaPageInput): Promise<FacebookMediaPage>;
  /** Reads a raw Page Reels page. */
  listReelPage?(input: FacebookMediaPageInput): Promise<FacebookMediaPage>;
  /** Verifies Page ownership of one post or video before selection. */
  findOwnedPost?(input: {
    /** Connected Page whose ownership must match the provider response. */
    pageId: string;
    /** Decrypted Page credential used only for the provider request. */
    pageAccessToken: string;
    /** Exact provider post or video identifier to verify. */
    mediaId: string;
  }): Promise<SocialMediaItem | null>;
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
      full_picture: z.string().url().nullish(),
    }),
  ),
});
const subscriptionSchema = z.object({ success: z.literal(true) });

const catalogPostSchema = z.object({
  id: z.string().min(1),
  message: z.string().nullish(),
  description: z.string().nullish(),
  permalink_url: z.string().url().nullish(),
  full_picture: z.string().url().nullish(),
  picture: z.string().url().nullish(),
  created_time: z.string().nullish(),
  from: z.object({ id: z.string() }).optional(),
});
const catalogPostsSchema = z.object({
  data: z.array(catalogPostSchema),
  paging: z
    .object({
      cursors: z.object({ after: z.string().optional() }).optional(),
      next: z.string().optional(),
    })
    .optional(),
});
const postCatalogFields = 'id,message,permalink_url,full_picture,created_time,from';
const reelCatalogFields = 'id,description,permalink_url,picture,created_time,from';
const normalizePost = (
  item: z.infer<typeof catalogPostSchema>,
  reel: boolean,
): SocialMediaItem => ({
  id: item.id,
  caption: item.message ?? item.description ?? null,
  mediaType: reel ? 'VIDEO' : 'POST',
  contentKind: reel ? 'reel' : 'post',
  mediaUrl: null,
  permalink: item.permalink_url ?? null,
  thumbnailUrl: item.full_picture ?? item.picture ?? null,
  timestamp: item.created_time ?? null,
});

/** Creates a Facebook Page adapter with bounded discovery pagination. */
export const createFacebookPageClient = (
  config: FacebookPageConfig,
  fetcher: typeof fetch = fetch,
): FacebookPageClient => {
  const readPage = async (
    input: { pageId: string; pageAccessToken: string; limit: number; after?: string },
    reel: boolean,
  ) => {
    const url = new URL(
      `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(input.pageId)}/${reel ? 'video_reels' : 'posts'}`,
    );
    url.searchParams.set('fields', reel ? reelCatalogFields : postCatalogFields);
    url.searchParams.set('limit', String(input.limit));
    if (input.after) url.searchParams.set('after', input.after);
    const data = expectFacebookResponse(
      'list_page_posts',
      (value) => catalogPostsSchema.safeParse(value),
      await requestFacebookJson(
        'list_page_posts',
        url,
        { method: 'GET', headers: { Authorization: `Bearer ${input.pageAccessToken}` } },
        fetcher,
      ),
    );
    return {
      media: data.data.map((item) => normalizePost(item, reel)),
      after: data.paging?.next ? (data.paging.cursors?.after ?? null) : null,
    };
  };
  return {
    listPostPage: (input) => readPage(input, false),
    listReelPage: (input) => readPage(input, true),
    async findOwnedPost({ pageId, pageAccessToken, mediaId }) {
      const reel = !mediaId.includes('_');
      const url = new URL(
        `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(mediaId)}`,
      );
      url.searchParams.set('fields', reel ? reelCatalogFields : postCatalogFields);
      const item = expectFacebookResponse(
        'list_page_posts',
        (value) => catalogPostSchema.safeParse(value),
        await requestFacebookJson(
          'list_page_posts',
          url,
          { method: 'GET', headers: { Authorization: `Bearer ${pageAccessToken}` } },
          fetcher,
        ),
      );
      if (item.from?.id !== pageId) return null;
      if (!reel) return normalizePost(item, false);
      // A video owner proves Page ownership, not that the video is a Reel.
      // Verify membership on Meta's Reel edge without interpreting URL formats.
      let after: string | undefined;
      const seenCursors = new Set<string>();
      for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
        const page = await readPage(
          { pageId, pageAccessToken, limit: 100, ...(after ? { after } : {}) },
          true,
        );
        const selected = page.media.find((media) => media.id === mediaId);
        if (selected) return selected;
        if (!page.after || seenCursors.has(page.after)) return null;
        seenCursors.add(page.after);
        after = page.after;
      }
      return null;
    },
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
        `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(pageId)}/posts`,
      );
      url.searchParams.set('fields', 'id,message,permalink_url,full_picture');
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
        pictureUrl: post.full_picture ?? null,
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
  };
};
