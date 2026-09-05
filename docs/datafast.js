// Mintlify loads custom JavaScript on every page after it becomes interactive.
(() => {
  // Keep local development and Mintlify previews out of production analytics.
  if (!["towbar.dev", "www.towbar.dev"].includes(window.location.hostname)) {
    return;
  }

  // Custom scripts can run again during navigation or preview updates.
  if (document.getElementById("towbar-datafast")) return;

  // Queue goals clicked before the analytics script has finished loading.
  window.datafast =
    window.datafast ||
    function () {
      window.datafast.q = window.datafast.q || [];
      window.datafast.q.push(arguments);
    };

  function trackGitHubClick(event) {
    if (event.type === "auxclick" ? event.button !== 1 : event.button !== 0) {
      return;
    }
    const link =
      event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) return;

    const url = new URL(link.href);
    if (
      url.hostname !== "github.com" ||
      !/^\/avgeek-inc\/towbar\/?$/i.test(url.pathname)
    ) {
      return;
    }

    window.datafast("github_click", {
      placement: link.closest("#navbar")
        ? "navbar"
        : link.closest(".towbar-home")
          ? "homepage"
          : "docs",
    });
  }

  // Delegation also covers links rendered after client-side navigation.
  document.addEventListener("click", trackGitHubClick, { capture: true });
  document.addEventListener("auxclick", trackGitHubClick, { capture: true });

  const script = document.createElement("script");
  script.id = "towbar-datafast";
  script.src = "https://datafa.st/js/script.js";
  script.async = true;
  script.defer = true;
  script.dataset.websiteId = "dfid_pFhOpbhEzeuHAKKFF418i";
  script.dataset.domain = "towbar.dev";
  document.head.appendChild(script);
})();
