import { z } from 'zod';

import { expectFacebookResponse, requestFacebookJson } from './http.js';

/** Facebook scopes used only to identify a person for ReplyKit sign-in. */
export const facebookSignInScopes = ['public_profile'] as const;

/** Page permissions requested when an authenticated user connects a Facebook Page. */
export const facebookPageScopes = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_metadata',
  'pages_manage_engagement',
  'pages_messaging',
] as const;

/** Purpose of one browser-bound Facebook OAuth attempt. */
export type FacebookLoginIntent = 'sign_in' | 'connect_page';

/** Server-only identity and token returned by Facebook Login. */
export interface FacebookLoginResult {
  /** App-scoped Facebook person ID, stable only for this Meta app. */
  facebookUserId: string;
  /** Display name safe for the signed-in owner to see. */
  displayName: string;
  /** User access token for immediate Page discovery; never send to the browser. */
  accessToken: string;
  /** Meta-reported expiration when supplied. */
  tokenExpiresAt: Date | null;
}

/** Facebook OAuth capability used by authentication and Page connection routes. */
export interface FacebookLoginClient {
  /** Creates a versioned Facebook authorization URL with a caller-owned random state. */
  authorizationUrl(state: string, intent: FacebookLoginIntent): string;
  /** Exchanges an authorization code and reads the app-scoped Facebook identity. */
  completeLogin(code: string): Promise<FacebookLoginResult>;
}

/** Server-side Facebook Login settings. */
export interface FacebookLoginConfig {
  /** Numeric Meta app ID. */
  appId: string;
  /** Optional Business Login configuration; Meta owns its permissions. */
  configId?: string | undefined;
  /** Meta app secret; never expose to the browser. */
  appSecret: string;
  /** Explicit Graph API version. */
  apiVersion: string;
  /** Exactly registered same-origin callback URL. */
  redirectUri: string;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
});
const profileSchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string().trim().min(1),
});

/** Creates a Facebook Login adapter with injectable HTTP transport. */
export const createFacebookLoginClient = (
  config: FacebookLoginConfig,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): FacebookLoginClient => ({
  authorizationUrl(state, intent) {
    const url = new URL(`https://www.facebook.com/${config.apiVersion}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: config.appId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      ...(config.configId
        ? { config_id: config.configId }
        : {
            scope: (intent === 'connect_page' ? facebookPageScopes : facebookSignInScopes).join(
              ',',
            ),
          }),
      state,
    }).toString();
    return url.toString();
  },
  async completeLogin(code) {
    const tokenUrl = new URL(`https://graph.facebook.com/${config.apiVersion}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      code,
      redirect_uri: config.redirectUri,
    }).toString();
    const token = expectFacebookResponse(
      'login_token',
      (value) => tokenSchema.safeParse(value),
      await requestFacebookJson('login_token', tokenUrl, { method: 'GET' }, fetcher),
    );
    const profileUrl = new URL(`https://graph.facebook.com/${config.apiVersion}/me`);
    profileUrl.searchParams.set('fields', 'id,name');
    const profile = expectFacebookResponse(
      'login_profile',
      (value) => profileSchema.safeParse(value),
      await requestFacebookJson(
        'login_profile',
        profileUrl,
        { method: 'GET', headers: { Authorization: `Bearer ${token.access_token}` } },
        fetcher,
      ),
    );
    return {
      facebookUserId: profile.id,
      displayName: profile.name,
      accessToken: token.access_token,
      tokenExpiresAt: token.expires_in ? new Date(now() + token.expires_in * 1000) : null,
    };
  },
});
