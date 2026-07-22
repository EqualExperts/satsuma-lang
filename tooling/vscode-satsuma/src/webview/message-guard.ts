/**
 * message-guard.ts — provenance check for messages arriving in webview scripts.
 *
 * Every webview entry point listens for window `message` events to receive
 * data from the extension host. VS Code delivers those messages into the
 * webview's own frame, so a legitimate message's `origin` equals the webview
 * window's own origin. Messages from any other window — for example content
 * embedded inside the webview in the future — carry a different origin and
 * must be ignored (Semgrep: insufficient-postmessage-origin-validation).
 *
 * The check compares `event.origin` against the webview's own `window.origin`
 * rather than pinning a hardcoded string: the concrete origin differs across
 * VS Code desktop, web, and remote hosts (and embeds a per-webview UUID), but
 * a host message always shares the webview's own origin. This is the check the
 * VS Code team recommends for extension-to-webview messaging (see sl-b90g).
 *
 * Note: an earlier revision (sl-mrn3) compared `event.source` to
 * `window.parent`. That invariant does not hold in the VS Code runtime — host
 * messages do not arrive with `source === window.parent` — so the guard
 * silently dropped every host message and broke all four webviews.
 */

/**
 * True when a `message` event was posted by the extension host (and so carries
 * the webview's own origin) rather than by embedded or foreign content.
 *
 * `selfOrigin` is injected — call sites pass `window.origin` — so the rule
 * stays testable outside a browser environment.
 */
export function isExtensionHostMessage(
  event: Pick<MessageEvent, "origin">,
  selfOrigin: string,
): boolean {
  return event.origin === selfOrigin;
}
