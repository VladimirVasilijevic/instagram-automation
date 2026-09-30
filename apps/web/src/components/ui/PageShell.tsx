import type { ReactNode } from 'react';

type AccountMenu = {
  username: string;
  loggingOut: boolean;
  onLogout: () => void;
};

const navigation = [
  {
    href: '/app',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: '/account',
    label: 'Account',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/status',
    label: 'Status',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12h4l2.5-7 5 14 2.5-7h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/privacy',
    label: 'Privacy',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3 19 6v5c0 4.6-2.9 8.3-7 10-4.1-1.7-7-5.4-7-10V6l7-3Z" />
        <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
] as const;

/** Shared responsive frame for the existing public and account pages. */
export const PageShell = ({
  children,
  accountMenu,
}: {
  children: ReactNode;
  accountMenu?: AccountMenu;
}) => {
  const path = window.location.pathname;
  const usernameMark = accountMenu?.username.slice(0, 2).toUpperCase() || '';

  return (
    <div className="app-page">
      <header className="border-b border-[var(--app-border)] bg-white/90">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <a
              className="ui-focus inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg text-sm font-semibold tracking-tight text-[#292638]"
              href="/"
            >
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#5632a8] text-lg text-white"
              >
                ✳
              </span>
              <span className="truncate">Instagram Automation</span>
            </a>
            {accountMenu && (
              <details className="group relative z-30 shrink-0">
                <summary
                  aria-label={`Account menu for @${accountMenu.username}`}
                  className="ui-focus flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-[var(--app-border)] bg-white px-2.5 py-1.5 shadow-sm [&::-webkit-details-marker]:hidden"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 place-items-center rounded-full bg-[#eee7f8] text-xs font-bold text-[#432487]"
                  >
                    {usernameMark}
                  </span>
                  <svg
                    aria-hidden="true"
                    className="size-4 text-[#625b6e] transition-transform group-open:rotate-180"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <div className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[var(--app-border)] bg-white py-1 shadow-lg">
                  <div className="border-b border-[var(--app-border)] px-4 py-3">
                    <p className="truncate text-sm font-semibold text-[#292638]">
                      @{accountMenu.username}
                    </p>
                    <p className="mt-0.5 text-xs text-[#625b6e]">Instagram account</p>
                  </div>
                  <a
                    className="ui-focus flex min-h-11 items-center px-4 text-sm text-[#403a49] hover:bg-[#f5f2ed]"
                    href="/account"
                  >
                    Account details
                  </a>
                  <a
                    className="ui-focus flex min-h-11 items-center px-4 text-sm text-[#403a49] hover:bg-[#f5f2ed]"
                    href="/privacy"
                  >
                    Privacy information
                  </a>
                  <a
                    className="ui-focus flex min-h-11 items-center px-4 text-sm text-[#403a49] hover:bg-[#f5f2ed]"
                    href="/status"
                  >
                    Service status
                  </a>
                  <div className="mt-1 border-t border-[var(--app-border)] pt-1">
                    <button
                      aria-busy={accountMenu.loggingOut}
                      aria-live="polite"
                      className="ui-focus flex min-h-11 w-full items-center px-4 text-left text-sm text-[#403a49] hover:bg-[#f5f2ed] disabled:cursor-wait disabled:opacity-60"
                      disabled={accountMenu.loggingOut}
                      onClick={accountMenu.onLogout}
                    >
                      {accountMenu.loggingOut ? 'Logging out…' : 'Log out'}
                    </button>
                  </div>
                </div>
              </details>
            )}
          </div>
          <nav
            aria-label="Main navigation"
            className="fixed inset-x-0 bottom-0 z-20 flex border-t border-[var(--app-border)] bg-white/95 px-2 pt-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(41_38_56/6%)] backdrop-blur md:static md:z-auto md:gap-1 md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none"
          >
            {navigation.map(({ href, label, icon }) => {
              const current = path === href || (href === '/app' && path === '/');
              return (
                <a
                  key={href}
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={`ui-focus flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-xs font-medium md:min-h-11 md:flex-none md:flex-row md:gap-1.5 md:px-3 md:text-sm ${
                    current
                      ? 'text-[#5632a8] md:bg-[#eee7f8] md:text-[#432487]'
                      : 'text-[#625b6e] hover:bg-[#f5f2ed] hover:text-[#292638]'
                  }`}
                >
                  <span aria-hidden="true" className="size-5 md:hidden">
                    {icon}
                  </span>
                  {label}
                </a>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pt-7 pb-24 sm:px-6 sm:pt-10 md:pb-10">
        {children}
      </main>
    </div>
  );
};
