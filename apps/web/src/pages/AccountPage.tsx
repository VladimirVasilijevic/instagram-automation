import { useEffect, useState } from 'react';

import { getCurrentAccount, logout, type CurrentAccount } from '../api/auth.js';
import { AutomationEditor } from '../components/AutomationEditor.js';
import { WebhookSubscription } from '../components/WebhookSubscription.js';

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
const buttonStyle =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60';

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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#ffffff_0%,_#f6f7fb_45%,_#eef1f7_100%)] px-4 py-12 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <header>
          <p className="text-sm font-semibold tracking-wide text-indigo-700 uppercase">
            Instagram Automation
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Your Instagram connection
          </h1>
          <p className="mt-4 leading-7 text-slate-600">
            Connect your professional account to get started.
          </p>
        </header>
        <section
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
          aria-live="polite"
          aria-busy={state.status === 'loading' || loggingOut}
        >
          {state.status === 'loading' && (
            <p role="status" className="text-slate-600">
              Checking your connection…
            </p>
          )}
          {state.status === 'error' && (
            <>
              <p role="alert" className="text-slate-700">
                We could not check your account. Please try again.
              </p>
              <button
                className={`${buttonStyle} mt-5`}
                onClick={() => {
                  setState({ status: 'loading' });
                  setAttempt((value) => value + 1);
                }}
              >
                Try again
              </button>
            </>
          )}
          {state.status === 'signed-out' && (
            <>
              <h2 className="text-xl font-semibold text-slate-950">Connect with Instagram</h2>
              <p className="mt-3 leading-7 text-slate-600">
                Use a Business or Creator account. Instagram will ask you to allow access to your
                profile and comments.
              </p>
              {loginError && (
                <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  {loginError}
                </p>
              )}
              <a
                className={`${buttonStyle} mt-6 w-full sm:w-auto`}
                href="/api/auth/instagram/start"
              >
                Continue with Instagram
              </a>
            </>
          )}
          {state.status === 'connected' && (
            <>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
                Connected
              </span>
              <h2 className="mt-5 text-xl font-semibold break-words text-slate-950">
                Connected as @{state.account.username}
              </h2>
              <p className="mt-3 leading-7 text-slate-600">
                Your Instagram account is connected. Choose a post and configure its reply, then
                enable comment delivery.
              </p>
              <AutomationEditor />
              <WebhookSubscription />
              {logoutError && (
                <p role="alert" className="mt-4 text-sm text-red-800">
                  Logout could not be completed. Please try again.
                </p>
              )}
              <button
                className={`${buttonStyle} mt-6`}
                disabled={loggingOut}
                onClick={() => void handleLogout()}
              >
                {loggingOut ? 'Logging out…' : 'Log out'}
              </button>
            </>
          )}
        </section>
        <footer className="mt-8 text-sm text-slate-500">
          <a className="underline underline-offset-4 hover:text-slate-800" href="/status">
            Service status
          </a>
        </footer>
      </div>
    </main>
  );
};
