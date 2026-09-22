import { AccountPage } from './pages/AccountPage.js';
import { PrivacyPage } from './pages/PrivacyPage.js';
import { StatusPage } from './pages/StatusPage.js';

/** Selects the account screens or preserved infrastructure status page by browser path. */
export const App = () => {
  const path = window.location.pathname;
  if (path === '/privacy') return <PrivacyPage />;
  if (path === '/status') return <StatusPage />;
  if (path === '/' || path === '/app') return <AccountPage />;
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-slate-950">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <a className="mt-4 inline-block underline" href="/">
        Return to Instagram Automation
      </a>
    </main>
  );
};
