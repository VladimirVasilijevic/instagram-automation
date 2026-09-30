import { useEffect, useState } from 'react';

import { getCurrentAccount, logout, type CurrentAccount } from '../api/auth.js';
import { AutomationEditor } from '../components/AutomationEditor.js';
import { MaintenanceHealthCard } from '../components/MaintenanceHealthCard.js';
import { RecentActivity } from '../components/RecentActivity.js';
import { WebhookSubscription } from '../components/WebhookSubscription.js';
import { PageShell } from '../components/ui/PageShell.js';

type AccountState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'connected'; account: CurrentAccount }
  | { status: 'error' };

const loginErrors: Record<string, string> = {
  invalid_state: 'This login attempt expired or could not be verified. Please start again.',
  cancelled: 'Instagram login was cancelled. You can try again when you are ready.',
  permissions: 'Allow profile and comment access in Instagram to connect your account.',
  unavailable: 'We could not complete Instagram login. Please try again.',
  configuration: 'Instagram login is not configured for this website address yet.',
};
/** Renders the connect and account screens using only safe, same-origin session responses. */
export const AccountPage = () => {
  const [state, setState] = useState<AccountState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [loginError, setLoginError] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('login_error');
    return code && Object.hasOwn(loginErrors, code) ? loginErrors[code] : undefined;
  });

  useEffect(() => {
    const controller = new AbortController();
    void getCurrentAccount(controller.signal)
      .then((account) => {
        if (controller.signal.aborted) return;
        setState(account ? { status: 'connected', account } : { status: 'signed-out' });
        window.history.replaceState(null, '', account ? '/app' : '/');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

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

  return (
    <PageShell>
      <header className="max-w-2xl">
        <p className="text-sm font-semibold tracking-wide text-[#5632a8] uppercase">
          {state.status === 'connected' ? 'Your workspace' : 'Instagram comment automation'}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#292638] sm:text-4xl">
          {state.status === 'connected' ? 'Dashboard' : 'Reply to comments with confidence'}
        </h1>
        <p className="mt-3 text-base leading-7 text-[#625b6e]">
          {state.status === 'connected'
            ? 'Manage your connected account, automation, and recent replies.'
            : 'Connect your professional account, choose a post, and set up your replies.'}
        </p>
      </header>

      <div aria-live="polite" aria-busy={state.status === 'loading' || loggingOut}>
        {state.status === 'loading' && (
          <section className="ui-card mt-6 p-5 sm:p-6">
            <p role="status" className="text-[#625b6e]">
              Checking your connection…
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
            <h2 className="text-xl font-semibold text-[#292638]">Connect with Instagram</h2>
            <p className="mt-2 leading-7 text-[#625b6e]">
              Use a Business or Creator account. Instagram will ask you to allow access to your
              profile and comments.
            </p>
            {loginError && (
              <p role="alert" className="ui-alert ui-alert-warning mt-4">
                {loginError}
              </p>
            )}
            <a className="ui-button mt-6 w-full sm:w-auto" href="/api/auth/instagram/start">
              Continue with Instagram
            </a>
            <p className="mt-4 text-sm text-[#625b6e]">
              You will review the requested permissions on Instagram.
            </p>
          </section>
        )}
        {state.status === 'connected' && (
          <div className="mt-6 grid gap-5">
            <section className="ui-card p-5 sm:p-6" aria-labelledby="account-heading">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-[#625b6e] uppercase">
                    Connected account
                  </p>
                  <h2
                    id="account-heading"
                    className="mt-1 text-xl font-semibold break-words text-[#292638]"
                  >
                    Connected as @{state.account.username}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#625b6e]">
                    Choose a post and configure its reply, then enable comment delivery.
                  </p>
                </div>
                <span
                  className={`inline-flex w-fit shrink-0 items-center rounded-full border px-3 py-1 text-sm font-semibold ${
                    state.account.connectionStatus === 'active'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  {state.account.connectionStatus === 'active' ? 'Connected' : 'Reconnect required'}
                </span>
              </div>
              {state.account.connectionStatus === 'reconnect_required' && (
                <div className="ui-alert ui-alert-warning mt-5">
                  <p role="alert" className="font-semibold">
                    Reconnect Instagram
                  </p>
                  <p className="mt-1">
                    Instagram rejected or expired this connection. Automation is paused until you
                    reconnect.
                  </p>
                  <a className="ui-button mt-3 w-full sm:w-auto" href="/api/auth/instagram/start">
                    Reconnect Instagram
                  </a>
                </div>
              )}
              {logoutError && (
                <p role="alert" className="ui-alert ui-alert-error mt-4">
                  Logout could not be completed. Please try again.
                </p>
              )}
              <button
                className="ui-button-secondary mt-5 w-full sm:w-auto"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
              >
                {loggingOut ? 'Logging out…' : 'Log out'}
              </button>
            </section>
            <AutomationEditor />
            <WebhookSubscription />
            <RecentActivity />
            <MaintenanceHealthCard />
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
