import type { ReactNode } from 'react';

const navigation = [
  { href: '/app', label: 'Dashboard' },
  { href: '/status', label: 'Status' },
  { href: '/privacy', label: 'Privacy' },
] as const;

/** Shared responsive frame for the existing public and account pages. */
export const PageShell = ({ children }: { children: ReactNode }) => {
  const path = window.location.pathname;
  return (
    <div className="app-page">
      <header className="border-b border-[var(--app-border)] bg-white/90">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between">
          <a
            className="ui-focus inline-flex min-h-11 items-center gap-2 self-start rounded-lg text-sm font-semibold tracking-tight text-[#292638]"
            href="/"
          >
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-xl bg-[#5632a8] text-lg text-white"
            >
              ✳
            </span>
            Instagram Automation
          </a>
          <nav aria-label="Main navigation" className="flex gap-1">
            {navigation.map(({ href, label }) => {
              const current = path === href || (href === '/app' && path === '/');
              return (
                <a
                  key={href}
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={`ui-focus flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium md:flex-none ${
                    current
                      ? 'bg-[#eee7f8] text-[#432487]'
                      : 'text-[#625b6e] hover:bg-[#f5f2ed] hover:text-[#292638]'
                  }`}
                >
                  {label}
                </a>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
};
