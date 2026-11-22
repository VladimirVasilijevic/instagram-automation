import type { SocialContentKind, SocialMediaItem } from '@instagram-automation/contracts';

import type {
  SocialConnection,
  SocialConnectionRepository,
} from '../database/identity-repositories.js';
import type { InstagramAccount } from '../database/repositories.js';
import type { FacebookPageClient } from '../facebook/page-client.js';
import type { InstagramMediaClient } from '../instagram/media-client.js';
import type { TokenProtector } from '../security/token-protector.js';

/** Authenticated ownership context for media discovery. */
export interface MediaOwner {
  /** Connection selected by the authenticated session. */
  connection: SocialConnection;
  /** Instagram credential holder, absent for a Facebook Page. */
  account: InstagramAccount | null;
}

/** Owner-scoped query for one category of published media. */
export interface MediaCatalogListInput extends MediaOwner {
  /** Maximum item count, from one through twelve. */
  limit: number;
  /** Optional published content category to select. */
  kind?: SocialContentKind;
  /** Opaque continuation bound to the selected connection and category. */
  cursor?: string;
}

/** Normalized catalog results returned to the authenticated media browser. */
export interface MediaCatalogPage {
  /** Provider-owned published content matching the requested category. */
  media: SocialMediaItem[];
  /** Opaque continuation cursor, or null when browsing is complete. */
  nextCursor: string | null;
}

/** Owner-scoped lookup of one selected media item. */
export interface MediaOwnershipInput extends MediaOwner {
  /** Exact provider identifier whose ownership is verified. */
  mediaId: string;
}

/** Shared provider boundary for browsing and validating selected content. */
export interface MediaCatalog {
  /** Returns a bounded page of owned content; cursor is scoped to connection and category. */
  list(input: MediaCatalogListInput): Promise<MediaCatalogPage>;
  /** Verifies ownership directly without depending on the newest twelve posts. */
  findOwned(input: MediaOwnershipInput): Promise<SocialMediaItem | null>;
}

/** Catalog provider dependencies; all access tokens remain server side. */
export interface MediaCatalogDependencies {
  /** Instagram media provider. */
  instagramMediaClient: InstagramMediaClient;
  /** Optional Facebook provider. */
  facebookPageClient?: FacebookPageClient;
  /** Encrypted Facebook Page credential lookup. */
  socialConnectionRepository?: Pick<SocialConnectionRepository, 'findFacebookPageByPageId'>;
  /** Decrypts tokens immediately before the provider request. */
  tokenProtector: TokenProtector;
}

/** Rejected opaque cursor; safe to expose as a query error. */
export class InvalidMediaCursorError extends Error {
  constructor() {
    super('Invalid media cursor');
    this.name = 'InvalidMediaCursorError';
  }
}
const cursorSchema = (
  cursor: string | undefined,
  connection: SocialConnection,
  kind: SocialContentKind | undefined,
): string | undefined => {
  if (!cursor) return undefined;
  try {
    if (cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      value.connection !== connection.id ||
      value.kind !== (kind ?? 'all') ||
      typeof value.after !== 'string' ||
      !value.after ||
      value.after.length > 2048
    )
      throw new Error();
    return value.after;
  } catch {
    throw new InvalidMediaCursorError();
  }
};
const encodeCursor = (
  after: string | null,
  connection: SocialConnection,
  kind: SocialContentKind | undefined,
) =>
  after
    ? Buffer.from(
        JSON.stringify({ connection: connection.id, kind: kind ?? 'all', after }),
      ).toString('base64url')
    : null;

/** Creates the application-owned catalog shared by media browsing and automation selection. */
export const createMediaCatalog = (dependencies: MediaCatalogDependencies): MediaCatalog => {
  const facebookCredential = async (connection: SocialConnection) => {
    const page = await dependencies.socialConnectionRepository?.findFacebookPageByPageId(
      connection.externalAccountId,
    );
    if (!page || page.id !== connection.id || page.userId !== connection.userId)
      throw new Error('Facebook Page credential unavailable');
    return {
      pageId: page.externalAccountId,
      pageAccessToken: dependencies.tokenProtector.decrypt(page.accessTokenCiphertext),
    };
  };
  const instagramCredential = ({ connection, account }: MediaOwner) => {
    if (!account || account.instagramUserId !== connection.externalAccountId)
      throw new Error('Instagram credential unavailable');
    return {
      accessToken: dependencies.tokenProtector.decrypt(account.accessTokenCiphertext),
      instagramUserId: account.instagramUserId,
    };
  };
  return {
    async list(input) {
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 12)
        throw new RangeError('Invalid media limit');
      let after = cursorSchema(input.cursor, input.connection, input.kind);
      const media: SocialMediaItem[] = [];
      const seen = new Set<string>();
      // At most five provider pages per request; return a continuation even when filtering is sparse.
      for (let page = 0; page < 5; page += 1) {
        const limit = input.limit - media.length;
        let result: { media: SocialMediaItem[]; after: string | null };
        if (input.connection.provider === 'instagram') {
          const credential = instagramCredential(input);
          const read =
            input.kind === 'story'
              ? dependencies.instagramMediaClient.listStoriesPage
              : dependencies.instagramMediaClient.listMediaPage;
          if (!read) throw new Error('Instagram catalog unavailable');
          result = await read({
            ...credential,
            limit,
            ...(after ? { after } : {}),
          });
        } else {
          if (input.kind === 'story') throw new Error('Facebook Stories are not supported');
          const client = dependencies.facebookPageClient;
          const read = input.kind === 'reel' ? client?.listReelPage : client?.listPostPage;
          if (!read) throw new Error('Facebook catalog unavailable');
          result = await read({
            ...(await facebookCredential(input.connection)),
            limit,
            ...(after ? { after } : {}),
          });
        }
        for (const item of result.media)
          if ((!input.kind || item.contentKind === input.kind) && !seen.has(item.id)) {
            media.push(item);
            seen.add(item.id);
          }
        const previous = after;
        after = result.after ?? undefined;
        if (after === previous) after = undefined;
        if (!after || media.length >= input.limit) break;
      }
      return { media, nextCursor: encodeCursor(after ?? null, input.connection, input.kind) };
    },
    async findOwned(input) {
      if (input.connection.provider === 'instagram') {
        if (!dependencies.instagramMediaClient.findOwnedMedia)
          throw new Error('Instagram ownership validation unavailable');
        return dependencies.instagramMediaClient.findOwnedMedia({
          ...instagramCredential(input),
          limit: 1,
          mediaId: input.mediaId,
        });
      }
      if (!dependencies.facebookPageClient?.findOwnedPost)
        throw new Error('Facebook ownership validation unavailable');
      return dependencies.facebookPageClient.findOwnedPost({
        ...(await facebookCredential(input.connection)),
        mediaId: input.mediaId,
      });
    },
  };
};
