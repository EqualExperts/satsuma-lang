/**
 * message-guard.ts — provenance check for messages arriving in webview scripts.
 *
 * Every webview entry point listens for window `message` events to receive
 * data from the extension host. The host relays those messages through the
 * enclosing webview frame, so a legitimate message's `source` is always the
 * webview's parent window. Messages from any other window — for example
 * content embedded inside the webview in the future — must be ignored
 * (Semgrep: insufficient-postmessage-origin-validation).
 *
 * The check matches on `event.source` rather than pinning `event.origin`:
 * the origin string differs across VS Code desktop, web, and remote hosts,
 * while the parent-frame relay is an invariant of the webview architecture.
 */

/**
 * True when a `message` event was posted by the extension host (relayed via
 * the webview's parent frame) rather than by embedded or foreign content.
 *
 * `parentWindow` is injected — call sites pass `window.parent` — so the rule
 * stays testable outside a browser environment.
 */
export function isExtensionHostMessage(
  event: Pick<MessageEvent, "source">,
  parentWindow: unknown,
): boolean {
  return event.source === parentWindow;
}
