import { useEffect, useState } from 'react';

import { getCurrentViewer, logout, type CurrentViewer } from '../api/auth.js';
import { getCapabilities } from '../api/capabilities.js';
import {
  getPendingFacebookPages,
  selectFacebookPage,
  type PendingFacebookPage,
} from '../api/facebook-pages.js';
import { AutomationEditor } from '../components/AutomationEditor.js';
import { MaintenanceHealthCard } from '../components/MaintenanceHealthCard.js';
import { RecentActivity } from '../components/RecentActivity.js';
import { PageShell } from '../components/ui/PageShell.js';

type AccountState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; viewer: CurrentViewer }
  | { status: 'error' };

const loginErrors: Record<string, string> = {
  invalid_state: 'This login attempt expired or could not be verified. Please start again.',
  cancelled: 'Login was cancelled. You can try again when you are ready.',
  permissions: 'Allow the requested account and comment access to continue.',
  unavailable: 'We could not complete login. Please try again.',
  configuration: 'Login is not configured for this website address yet.',
  already_connected: 'A social account is already connected to this workspace.',
  identity_owned: 'This Facebook identity belongs to another ReplyKit account.',
  invalid_session: 'Your session changed during connection. Sign in and try again.',
  no_pages: 'No eligible Facebook Pages were returned. Check your Page access and try again.',
  insufficient_page_access:
    'No Page has comment moderation access. Ask a Page admin to grant MODERATE access and try again.',
};

/** Renders sign-in, connection, and automation screens from the safe session response. */
export const AccountPage = () => {
  const [state, setState] = useState<AccountState>({ status: 'loading' });
  const [facebookLoginEnabled, setFacebookLoginEnabled] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [selectionId, setSelectionId] = useState(() =>
    new URLSearchParams(window.location.search).get('facebook_selection'),
  );
  const [pendingPages, setPendingPages] = useState<
    | { status: 'loading' }
    | { status: 'ready'; pages: PendingFacebookPage[] }
    | { status: 'error' }
    | null
  >(null);
  const [selectingPageId, setSelectingPageId] = useState<string | null>(null);
  const [pageSelectionError, setPageSelectionError] = useState(false);
  const [loginError, setLoginError] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    const code =
      query.get('facebook_connect_error') ??
      query.get('facebook_login_error') ??
      query.get('login_error');
    return code && Object.hasOwn(loginErrors, code) ? loginErrors[code] : undefined;
  });

  useEffect(() => {
    const controller = new AbortController();
    void getCapabilities(controller.signal).then((capabilities) => {
      if (!controller.signal.aborted) setFacebookLoginEnabled(capabilities.facebookLoginEnabled);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getCurrentViewer(controller.signal)
      .then((viewer) => {
        if (controller.signal.aborted) return;
        setState(viewer ? { status: 'signed-in', viewer } : { status: 'signed-out' });
        const signedInPath = window.location.pathname === '/account' ? '/account' : '/app';
        window.history.replaceState(null, '', viewer ? signedInPath : '/');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (
      !selectionId ||
      state.status !== 'signed-in' ||
      state.viewer.connection?.provider === 'instagram'
    )
      return;
    let active = true;
    setPendingPages({ status: 'loading' });
    void getPendingFacebookPages(selectionId)
      .then((pages) => {
        if (active) setPendingPages({ status: 'ready', pages });
      })
      .catch(() => {
        if (active) setPendingPages({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [selectionId, state]);

  const handleSelectPage = async (pageId: string) => {
    if (!selectionId) return;
    setSelectingPageId(pageId);
    setPageSelectionError(false);
    try {
      await selectFacebookPage(selectionId, pageId);
      setSelectionId(null);
      setPendingPages(null);
      setState({ status: 'loading' });
      setAttempt((value) => value + 1);
    } catch {
      setPageSelectionError(true);
    } finally {
      setSelectingPageId(null);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(false);
    try {
      await logout();
      setState({ status: 'signed-out' });
      setLoginError(undefined);
      window.history.replaceState(null, '', '/');
    } catch {
      setLogoutError(true);
    } finally {
      setLoggingOut(false);
    }
  };

  const showingAccountDetails = window.location.pathname === '/account';
  const viewer = state.status === 'signed-in' ? state.viewer : null;
  const connection = viewer?.connection;
  const providerName = connection?.provider === 'facebook' ? 'Facebook Page' : 'Instagram';
  const reconnectPath =
    connection?.provider === 'facebook'
      ? '/api/connections/facebook/start'
      : '/api/auth/instagram/start';

  return (
    <PageShell
      accountMenu={
        viewer
          ? {
              label: viewer.user.displayName || connection?.displayName || 'ReplyKit account',
              loggingOut,
              onLogout: () => void handleLogout(),
            }
          : undefined
      }
    >
      <header className="max-w-2xl">
        <p className="text-sm font-semibold tracking-wide text-[#5632a8] uppercase">
          {viewer
            ? showingAccountDetails
              ? 'Account settings'
              : 'Your workspace'
            : 'Comment automation'}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#292638] sm:text-4xl">
          {viewer
            ? showingAccountDetails
              ? 'Account'
              : 'Dashboard'
            : 'Reply to comments with confidence'}
        </h1>
        <p className="mt-3 text-base leading-7 text-[#625b6e]">
          {viewer
            ? connection
              ? showingAccountDetails
                ? `Review your ${providerName} connection and automation health.`
                : 'Manage your automation and review recent replies.'
              : 'Connect a social account to set up comment replies.'
            : 'Sign in, connect a social account, and set up your replies.'}
        </p>
      </header>

      <div aria-live="polite" aria-busy={state.status === 'loading' || loggingOut}>
        {state.status === 'loading' && (
          <section className="ui-card mt-6 p-5 sm:p-6">
            <p role="status" className="text-[#625b6e]">
              Checking your session…
            </p>
          </section>
        )}
        {state.status === 'error' && (
          <section className="ui-card mt-6 p-5 sm:p-6">
            <p role="alert" className="ui-alert ui-alert-error">
              We could not check your account. Please try again.
            </p>
            <button
              className="ui-button mt-5"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          </section>
        )}
        {state.status === 'signed-out' && (
          <section className="ui-card mt-6 max-w-2xl p-5 sm:p-7">
            <h2 className="text-xl font-semibold text-[#292638]">Sign in to ReplyKit</h2>
            <p className="mt-2 leading-7 text-[#625b6e]">
              Choose a sign-in method. You can connect a social account after signing in.
            </p>
            {loginError && (
              <p role="alert" className="ui-alert ui-alert-warning mt-4">
                {loginError}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a className="ui-button w-full sm:w-auto" href="/api/auth/instagram/start">
                Continue with Instagram
              </a>
              {facebookLoginEnabled && (
                <a className="ui-button-secondary w-full sm:w-auto" href="/api/auth/facebook/start">
                  Continue with Facebook
                </a>
              )}
            </div>
          </section>
        )}
        {viewer && (
          <div className="mt-6 grid gap-5">
            {loginError && (
              <p role="alert" className="ui-alert ui-alert-warning">
                {loginError}
              </p>
            )}
            {logoutError && (
              <p role="alert" className="ui-alert ui-alert-error">
                Logout could not be completed. Please try again.
              </p>
            )}
            {selectionId && connection?.provider !== 'instagram' && (
              <section className="ui-card p-5 sm:p-6" aria-labelledby="page-choice-heading">
                <h2 id="page-choice-heading" className="text-xl font-semibold text-[#292638]">
                  Choose a Facebook Page
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#625b6e]">
                  Select the Page whose comments you want to automate.
                </p>
                {pendingPages?.status === 'loading' && (
                  <p role="status" className="mt-4 text-sm text-[#625b6e]">
                    Loading your Pages…
                  </p>
                )}
                {pendingPages?.status === 'error' && (
                  <p role="alert" className="ui-alert ui-alert-error mt-4">
                    We could not load your Pages. Restart the Facebook connection.
                  </p>
                )}
                {pendingPages?.status === 'ready' && pendingPages.pages.length === 0 && (
                  <p role="alert" className="ui-alert ui-alert-warning mt-4">
                    No eligible Facebook Pages were returned. Check your Page access and try again.
                  </p>
                )}
                {pendingPages?.status === 'ready' && pendingPages.pages.length > 0 && (
                  <ul className="mt-4 grid gap-3" aria-label="Facebook Pages">
                    {pendingPages.pages.map((page) => (
                      <li key={page.id}>
                        <button
                          className="ui-button-secondary w-full text-left"
                          type="button"
                          disabled={selectingPageId !== null}
                          onClick={() => void handleSelectPage(page.id)}
                        >
                          {selectingPageId === page.id ? 'Connecting…' : `Connect ${page.name}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {pageSelectionError && (
                  <p role="alert" className="ui-alert ui-alert-error mt-4">
                    The Page could not be connected. Try again.
                  </p>
                )}
                {facebookLoginEnabled && (
                  <a
                    className="ui-button-secondary mt-5 inline-flex w-full sm:w-auto"
                    href="/api/connections/facebook/start"
                  >
                    Restart Facebook connection
                  </a>
                )}
              </section>
            )}
            {!connection && !selectionId && (
              <section className="ui-card p-5 sm:p-6">
                <h2 className="text-xl font-semibold text-[#292638]">Connect a social account</h2>
                <p className="mt-2 text-sm leading-6 text-[#625b6e]">
                  Connect one Instagram professional account or Facebook Page to create an
                  automation.
                </p>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <a className="ui-button w-full sm:w-auto" href="/api/auth/instagram/start">
                    Connect Instagram
                  </a>
                  {facebookLoginEnabled && (
                    <a
                      className="ui-button-secondary w-full sm:w-auto"
                      href="/api/connections/facebook/start"
                    >
                      Connect Facebook Page
                    </a>
                  )}
                </div>
              </section>
            )}
            {connection &&
              (showingAccountDetails ? (
                <section className="ui-card p-5 sm:p-6" aria-labelledby="account-heading">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tracking-wide text-[#625b6e] uppercase">
                        Connected {providerName}
                      </p>
                      <h2
                        id="account-heading"
                        className="mt-1 text-xl font-semibold break-words text-[#292638]"
                      >
                        Connected as {connection.displayName}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[#625b6e]">
                        This connection owns the current automation and receives its comment events.
                      </p>
                    </div>
                    <span
                      className={`inline-flex w-fit shrink-0 items-center rounded-full border px-3 py-1 text-sm font-semibold ${
                        connection.connectionStatus === 'active'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-amber-200 bg-amber-50 text-amber-900'
                      }`}
                    >
                      {connection.connectionStatus === 'active'
                        ? 'Connected'
                        : 'Reconnect required'}
                    </span>
                  </div>
                  {connection.connectionStatus === 'reconnect_required' && (
                    <div className="ui-alert ui-alert-warning mt-5">
                      <p role="alert" className="font-semibold">
                        Reconnect {providerName}
                      </p>
                      <p className="mt-1">
                        This connection was rejected or expired. Automation is paused until you
                        reconnect.
                      </p>
                      {(connection.provider !== 'facebook' || facebookLoginEnabled) && (
                        <a className="ui-button mt-3 w-full sm:w-auto" href={reconnectPath}>
                          Reconnect {providerName}
                        </a>
                      )}
                    </div>
                  )}
                </section>
              ) : (
                <section className="ui-card p-5 sm:p-6" aria-labelledby="connection-heading">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold tracking-wide text-[#625b6e] uppercase">
                        {providerName} connection
                      </p>
                      <h2
                        id="connection-heading"
                        className="mt-1 text-xl font-semibold text-[#292638]"
                      >
                        {connection.connectionStatus === 'active'
                          ? 'Connected'
                          : 'Reconnect required'}
                      </h2>
                    </div>
                    <a className="ui-button-secondary w-full sm:w-auto" href="/account">
                      View account
                    </a>
                  </div>
                </section>
              ))}
            {connection &&
              (showingAccountDetails ? (
                <MaintenanceHealthCard />
              ) : (
                <>
                  <AutomationEditor
                    key={connection.id}
                    provider={connection.provider}
                    onSelectedMediaChange={setSelectedMediaId}
                  />
                  <RecentActivity
                    provider={connection.provider}
                    selectedMediaId={selectedMediaId}
                  />
                </>
              ))}
          </div>
        )}
      </div>
      <footer className="mt-8 text-sm text-[#625b6e]">
        <a
          className="ui-focus rounded underline underline-offset-4 hover:text-[#432487]"
          href="/status"
        >
          Service status
        </a>
      </footer>
    </PageShell>
  );
};
