/**
 * Publishes the privacy information required for the Meta app configuration.
 *
 * @returns A public, static privacy policy page.
 */
export const PrivacyPage = () => (
  <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#ffffff_0%,_#f6f7fb_45%,_#eef1f7_100%)] px-4 py-10 sm:px-6 sm:py-16">
    <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
      <header>
        <p className="text-sm font-semibold tracking-wide text-indigo-700 uppercase">
          Instagram Automation
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Privacy Policy</h1>
        <p className="mt-4 text-sm text-slate-500">Last updated: September 23, 2026</p>
      </header>

      <div className="mt-8 space-y-8 leading-7 text-slate-700">
        <section>
          <h2 className="text-xl font-semibold text-slate-950">What this app does</h2>
          <p className="mt-3">
            Instagram Automation connects an eligible Instagram professional account, lets the
            account owner choose media and configure comment-reply automation, and receives
            Instagram comment events for that connected account.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Information we collect</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>Instagram professional account ID and username provided through Meta login.</li>
            <li>An encrypted long-lived access token needed to call the Instagram API.</li>
            <li>Selected media IDs, automation settings, and configured reply text.</li>
            <li>
              Comment webhook information such as account, media, and comment IDs, commenter
              username, comment text, and receipt time.
            </li>
            <li>Short-lived browser cookies used to protect login and application sessions.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">How we use information</h2>
          <p className="mt-3">
            We use this information only to authenticate the connected account, display its
            Instagram media, save the owner&apos;s automation settings, receive comment events, and
            process configured replies through Meta&apos;s Instagram API.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Sharing and service providers</h2>
          <p className="mt-3">
            We do not sell or rent personal information. Information is sent to Meta/Instagram when
            required to authenticate the account, read permitted account data, receive subscribed
            events, or publish a configured reply. Hosting and database providers may process
            information on our behalf to operate this app.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Security and retention</h2>
          <p className="mt-3">
            Access tokens are kept on the server in encrypted storage and are not returned to the
            browser or written to application logs. We use HTTPS for deployed traffic. Account,
            automation, and activity data is retained while the account is connected and for as long
            as needed to operate the service, unless deletion is requested sooner.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Data deletion requests</h2>
          <p className="mt-3">
            To request deletion of data held by this app, email{' '}
            <a className="font-medium text-indigo-700 underline" href="mailto:wascke@gmail.com">
              wascke@gmail.com
            </a>{' '}
            with your Instagram username and a description of the request. We will verify the
            request and delete the app-held account, token, automation, and activity data that is
            covered by the request, subject to any legal retention requirement.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-slate-950">Contact</h2>
          <p className="mt-3">
            Questions about this policy or the handling of personal information can be sent to{' '}
            <a className="font-medium text-indigo-700 underline" href="mailto:wascke@gmail.com">
              wascke@gmail.com
            </a>
            .
          </p>
        </section>
      </div>

      <footer className="mt-10 border-t border-slate-200 pt-5 text-sm text-slate-500">
        <a className="underline underline-offset-4 hover:text-slate-800" href="/">
          Return to Instagram Automation
        </a>
      </footer>
    </article>
  </main>
);
