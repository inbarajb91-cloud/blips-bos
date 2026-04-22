import { LastSignalRedirect } from "./last-signal-redirect";

export const metadata = {
  title: "Signal Workspace · Engine Room · BLIPS BOS",
};

/**
 * Signal Workspace — section tab landing page.
 *
 * Users arrive here by clicking the "Signal Workspace" section tab from
 * anywhere in Engine Room. Behaviour:
 *
 *   - If they have a last-viewed signal in localStorage, redirect to it
 *     immediately so Signal Workspace feels "sticky" — same context as
 *     when they last left it. Returning next day also resumes.
 *   - Otherwise, show an editorial empty state pointing them to Bridge
 *     to pick a signal.
 *
 * The redirect has to be client-side because the shortcode is stored in
 * the user's browser, not the server.
 */
export default function SignalWorkspacePage() {
  return <LastSignalRedirect />;
}
