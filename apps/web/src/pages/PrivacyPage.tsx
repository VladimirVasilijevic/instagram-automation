import { APP_NAME } from '../brand.js';
import { PageShell } from '../components/ui/PageShell.js';

/**
 * Publishes the privacy information required for the Meta app configuration.
 *
 * @returns A public, static privacy policy page.
 */
export const PrivacyPage = () => (
  <PageShell>
    <article className="ui-card mx-auto max-w-3xl p-5 sm:p-10">
      <header>
        <p className="text-sm font-semibold tracking-wide text-[#5632a8] uppercase">{APP_NAME}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#292638]">Privacy Policy</h1>
        <p className="mt-4 text-sm text-[#625b6e]">Last updated: October 1, 2026</p>
      </header>

      <div className="mt-8 space-y-8 leading-7 text-[#433d50]">
        <section>
          <h2 className="text-xl font-semibold text-[#292638]">What this app does</h2>
          <p className="mt-3">
            {APP_NAME} connects an eligible Instagram professional account, lets the account owner
            choose media and configure public comment replies, private replies, or both, and
            receives Instagram comment events for that connected account.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[#292638]">Information we collect</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>Instagram professional account ID and username provided through Meta login.</li>
            <li>An encrypted long-lived access token needed to call the Instagram API.</li>
            <li>Selected media IDs, automation settings, and configured public or private text.</li>
            <li>
              Comment webhook information such as account, media, comment and commenter IDs,
              commenter username, comment text, and receipt time.
            </li>
            <li>Short-lived browser cookies used to protect login and application sessions.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[#292638]">How we use information</h2>
          <p className="mt-3">
            We use this information only to authenticate the connected account, display its
            Instagram media, save the owner&apos;s automation settings, receive comment events, and
            process configured public and private replies through Meta&apos;s Instagram API.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[#292638]">Sharing and service providers</h2>
          <p className="mt-3">
            We do not sell or rent personal information. Information is sent to Meta/Instagram when
            required to authenticate the account, read permitted account data, receive subscribed
            events, publish a configured comment reply, or send a comment-authorized private reply.
            Hosting and database providers may process information on our behalf to operate this
            app.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[#292638]">Security and retention</h2>
          <p className="mt-3">
            Access tokens are kept on the server in encrypted storage and are not returned to the
            browser or written to application logs. We use HTTPS for deployed traffic. Account,
            automation, and activity data is retained while the account is connected and for as long
            as needed to operate the service, unless deletion is requested sooner.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[#292638]">Data deletion requests</h2>
          <p className="mt-3">
            To request deletion of data held by this app, email{' '}
            <a
              className="ui-focus rounded font-medium text-[#5632a8] underline"
              href="mailto:wascke@gmail.com"
            >
              wascke@gmail.com
            </a>{' '}
            with your Instagram username and a description of the request. We will verify the
            request and delete the app-held account, token, automation, and activity data that is
            covered by the request, subject to any legal retention requirement.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-[#292638]">Contact</h2>
          <p className="mt-3">
            Questions about this policy or the handling of personal information can be sent to{' '}
            <a
              className="ui-focus rounded font-medium text-[#5632a8] underline"
              href="mailto:wascke@gmail.com"
            >
              wascke@gmail.com
            </a>
            .
          </p>
        </section>
      </div>

      <footer className="mt-10 border-t border-[var(--app-border)] pt-5 text-sm text-[#625b6e]">
        <a className="ui-focus rounded underline underline-offset-4 hover:text-[#432487]" href="/">
          Return to {APP_NAME}
        </a>
      </footer>
    </article>
  </PageShell>
);
