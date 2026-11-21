import type { SocialProvider } from '@instagram-automation/contracts';

import type { ProtectedToken } from '../security/token-protector.js';
import type { InstagramAccount } from './repositories.js';

/** Application owner independent of any social account. */
export interface User {
  /** Stable internal user identifier. */
  id: string;
  /** Time the user was created. */
  createdAt: Date;
}

/** Provider account connected to one application user. */
export interface SocialConnection {
  /** Stable internal connection identifier. */
  id: string;
  /** Owner of this connection. */
  userId: string;
  /** Social network supplying the account. */
  provider: SocialProvider;
  /** Provider-scoped account or Page identifier. */
  externalAccountId: string;
  /** Safe display name. */
  displayName: string;
  /** Whether provider calls are currently allowed. */
  connectionStatus: 'active' | 'reconnect_required';
}

/** Connected Facebook Page and its encrypted credential. */
export interface FacebookPageConnection extends SocialConnection {
  /** Page access token that must be decrypted only at the provider boundary. */
  accessTokenCiphertext: ProtectedToken;
}

/** Identity and connection resulting from a completed Instagram login. */
export interface InstagramSignInResult {
  /** Application user who owns the Instagram identity. */
  user: User;
  /** Connected Instagram account as a provider-neutral reference. */
  connection: SocialConnection;
  /** Instagram-specific token and profile fields. */
  account: InstagramAccount;
}

/** Data received from a completed provider login. */
export interface CompleteSignInInput {
  /** Provider that authenticated the person. */
  provider: SocialProvider;
  /** Provider-scoped person identifier. */
  externalUserId: string;
  /** Safe name shown in account lists. */
  displayName: string;
  /** Existing signed-in user when explicitly linking an identity. */
  intendedUserId?: string | null;
}

/** Data received from a completed Instagram login. */
export interface CompleteInstagramLoginInput {
  /** Instagram Professional account identifier. */
  instagramUserId: string;
  /** Current Instagram username. */
  username: string;
  /** Encrypted token returned by Instagram. */
  accessTokenCiphertext: ProtectedToken;
  /** Expiry of the Instagram token. */
  tokenExpiresAt: Date;
  /** Existing signed-in user when explicitly linking an Instagram account. */
  intendedUserId?: string | null;
}

/** Thrown when a provider identity or connection belongs to another user. */
export class IdentityOwnershipError extends Error {
  constructor() {
    super('Social identity belongs to another user');
    this.name = 'IdentityOwnershipError';
  }
}

/** Thrown when connecting a second social account is disabled for this release. */
export class ConnectionLimitError extends Error {
  constructor() {
    super('Only one social account can be connected currently');
    this.name = 'ConnectionLimitError';
  }
}

/** Atomic application-user and login-identity operations. */
export interface IdentityRepository {
  /** Finds or creates a user for a verified provider person, or links to a signed-in user. */
  completeSignIn(input: CompleteSignInInput): Promise<User>;
  /** Completes Instagram sign-in and account connection in one transaction. */
  completeInstagramLogin(input: CompleteInstagramLoginInput): Promise<InstagramSignInResult>;
}

/** Facebook Page connection values supplied after Page authorization. */
export interface ConnectFacebookPageInput {
  /** Signed-in ReplyKit user. */
  userId: string;
  /** Facebook Page identifier. */
  pageId: string;
  /** Current Page name. */
  pageName: string;
  /** Encrypted Page token. */
  accessTokenCiphertext: ProtectedToken;
}

/** One authorized Page awaiting an explicit owner selection. */
export interface PendingFacebookPage {
  /** Facebook Page identifier. */
  id: string;
  /** Safe Page name. */
  name: string;
  /** Encrypted Page token, kept only in private storage. */
  accessTokenCiphertext: ProtectedToken;
}

/** Safe selection values returned to the browser without credentials. */
export interface PendingPageSelection {
  /** Random selection identifier. */
  selectionId: string;
  /** Authorized Pages available to select. */
  pages: {
    /** Opaque Page identifier. */
    id: string;
    /** Safe Page name displayed for selection. */
    name: string;
  }[];
}

/** Pending Page choices supplied after Facebook authorization. */
export interface CreatePendingPageSelectionInput {
  /** Signed-in ReplyKit user. */
  userId: string;
  /** Pages for which Meta supplied a Page access token. */
  pages: PendingFacebookPage[];
}

/** A selected Page from a pending authorization attempt. */
export interface ConsumeSelectedPageInput {
  /** Signed-in ReplyKit user. */
  userId: string;
  /** Unpredictable pending selection identifier. */
  selectionId: string;
  /** Explicitly chosen Facebook Page identifier. */
  pageId: string;
}

/** Persistence for provider-neutral account ownership and Page credentials. */
export interface SocialConnectionRepository {
  /** Connects one Page, rejecting a Page owned by another user. */
  connectFacebookPage(input: ConnectFacebookPageInput): Promise<SocialConnection>;
  /** Stores encrypted Page token choices for a short-lived explicit selection. */
  createPendingPageSelection(input: CreatePendingPageSelectionInput): Promise<PendingPageSelection>;
  /** Returns only safe Page names and IDs for an owned, unexpired selection. */
  getPendingPageSelection(input: {
    userId: string;
    selectionId: string;
  }): Promise<PendingPageSelection | null>;
  /** Consumes one owned selection and connects the chosen Page atomically. */
  consumeSelectedPage(input: ConsumeSelectedPageInput): Promise<SocialConnection | null>;
  /** Loads the currently selected connection for a user. */
  findFirstByUserId(userId: string): Promise<SocialConnection | null>;
  /** Resolves a Page and protected token from its provider identifier. */
  findFacebookPageByPageId(pageId: string): Promise<FacebookPageConnection | null>;
  /** Marks a Facebook Page credential as rejected by the provider. */
  markReconnectRequired(connectionId: string, errorCode?: string): Promise<boolean>;
}
