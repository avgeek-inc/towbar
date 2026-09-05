// Enhance Mintlify's header while retaining its search dialog and theme menu.
(() => {
  // Mintlify can re-run custom scripts during preview updates.
  window.__towbarHeaderCleanup?.();
  let scheduled = false;
  let frame;
  window.__towbarHeaderCleanup = () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
  const observer = new MutationObserver(schedule);

  function enhanceHeader() {
    observer.disconnect();
    const header = document.getElementById("navbar");
    if (header) {
      for (const logo of header.querySelectorAll("a:has(.nav-logo)")) {
        if (!logo.querySelector("[data-towbar-wordmark]")) {
          const wordmark = document.createElement("span");
          wordmark.dataset.towbarWordmark = "";
          wordmark.setAttribute("aria-hidden", "true");
          wordmark.textContent = "Towbar";
          logo.append(wordmark);
        }
      }

      const theme = header.querySelector("#theme-preference-menu-trigger");
      const primary = header.querySelector("#topbar-cta-button a");
      const actions = theme?.parentElement?.parentElement;
      if (theme && primary && actions) {
        const existing = actions.querySelector("[data-towbar-primary]");
        if (
          !existing ||
          existing.getAttribute("href") !== primary.getAttribute("href") ||
          existing.textContent !== primary.textContent
        ) {
          const cta = primary.cloneNode(true);
          cta.dataset.towbarPrimary = "";
          cta.removeAttribute("target");
          if (existing) existing.replaceWith(cta);
          else actions.append(cta);
        }
        header.dataset.towbarEnhanced = "";
      }
    }
    observer.observe(document.body, { childList: true, subtree: true });
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
