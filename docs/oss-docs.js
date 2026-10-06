// Enhance Mintlify's header while retaining its search dialog and theme menu.
(() => {
  // Mintlify can re-run custom scripts during preview updates.
  window.__ossDocsHeaderCleanup?.();
  const settings = { name: "Towbar" };
  let scheduled = false;
  let frame;
  window.__ossDocsHeaderCleanup = () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    document.removeEventListener("DOMContentLoaded", schedule);
  };
  const observer = new MutationObserver(schedule);

  function enhanceHeader() {
    observer.disconnect();
    const header = document.getElementById("navbar");
    if (header) {
      for (const logo of header.querySelectorAll("a:has(.nav-logo)")) {
        if (!logo.querySelector("[data-oss-wordmark]")) {
          const wordmark = document.createElement("span");
          wordmark.dataset.ossWordmark = "";
          wordmark.setAttribute("aria-hidden", "true");
          wordmark.textContent = settings.name;
          logo.append(wordmark);
        }
      }

      const theme = header.querySelector("#theme-preference-menu-trigger");
      const primary = header.querySelector("#topbar-cta-button a");
      const actions = theme?.parentElement?.parentElement;
      const internal = primary?.getAttribute("href")?.startsWith("/");
      const target = internal ? null : primary?.getAttribute("target");
      if (theme && primary && actions) {
        const existing = actions.querySelector("[data-oss-primary]");
        if (
          !existing ||
          existing.getAttribute("href") !== primary.getAttribute("href") ||
          existing.textContent !== primary.textContent ||
          existing.getAttribute("target") !== target ||
          existing.getAttribute("rel") !== primary.getAttribute("rel")
        ) {
          const cta = primary.cloneNode(true);
          cta.dataset.ossPrimary = "";
          if (internal) cta.removeAttribute("target");
          if (existing) existing.replaceWith(cta);
          else actions.append(cta);
        }
        header.dataset.ossEnhanced = "";
      }
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "target", "rel"],
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    frame = requestAnimationFrame(() => {
      scheduled = false;
      enhanceHeader();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule, { once: true });
  } else {
    schedule();
  }
})();
