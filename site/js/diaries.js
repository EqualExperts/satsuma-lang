/* global marked, DOMPurify */
/* diaries.js — client-side diary reader
 *
 * Each diary entry is a small JSON file at satsuma-diaries/content/{date}.json,
 * generated at deploy/setup time from the source .md files. The JS fetches the
 * selected entry on demand so only the content the reader actually clicks on is
 * loaded. URL hash (#2026-03-29) is kept in sync for deep-linking.
 */

(function () {
  "use strict";

  const entryButtons = document.querySelectorAll(".diary-entry-btn");
  const contentEl = document.getElementById("diary-content");
  const loadingEl = document.getElementById("diary-loading");
  const errorEl = document.getElementById("diary-error");
  const emptyEl = document.getElementById("diary-empty");

  if (!entryButtons.length || !contentEl) return;

  marked.setOptions({ breaks: true, gfm: true });

  function showState(state) {
    contentEl.classList.toggle("hidden", state !== "content");
    loadingEl.classList.toggle("hidden", state !== "loading");
    errorEl.classList.toggle("hidden", state !== "error");
    emptyEl.classList.toggle("hidden", state !== "empty");
  }

  function setActiveButton(date) {
    entryButtons.forEach(function (btn) {
      const isActive = btn.dataset.date === date;
      btn.classList.toggle("bg-peach", isActive);
      btn.classList.toggle("text-orange-dark", isActive);
      btn.classList.toggle("font-semibold", isActive);
    });
  }

  function loadEntry(path, date) {
    setActiveButton(date);
    showState("loading");
    window.location.hash = date;

    fetch(path)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        // Strip the "# The Satsuma Diaries" H1 — the page already has a title
        const body = data.markdown.replace(/^# The Satsuma Diaries\n/, "");
        // Render via a DOM fragment rather than innerHTML to satisfy the
        // Semgrep insecure-document-method rule. DOMPurify.sanitize with
        // RETURN_DOM_FRAGMENT returns a DocumentFragment we can append
        // directly, so no raw HTML is ever assigned to .innerHTML.
        const fragment = DOMPurify.sanitize(marked.parse(body), { RETURN_DOM_FRAGMENT: true });
        contentEl.replaceChildren(fragment);
        showState("content");
        contentEl.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(function () {
        showState("error");
      });
  }

  entryButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      loadEntry(btn.dataset.path, btn.dataset.date);
    });
  });

  // Load from URL hash on page open, or default to the first (most recent) entry
  const hashDate = window.location.hash.replace("#", "");
  const target = hashDate
    ? Array.from(entryButtons).find(function (b) {
        return b.dataset.date === hashDate;
      })
    : entryButtons[0];

  if (target) {
    loadEntry(target.dataset.path, target.dataset.date);
  } else {
    showState("empty");
  }
})();
