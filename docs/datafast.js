// Mintlify loads custom JavaScript on every page after it becomes interactive.
(() => {
  // Keep local development and Mintlify previews out of production analytics.
  if (!["towbar.dev", "www.towbar.dev"].includes(window.location.hostname)) {
    return;
  }

  // Custom scripts can run again during navigation or preview updates.
  if (document.getElementById("towbar-datafast")) return;

  const script = document.createElement("script");
  script.id = "towbar-datafast";
  script.src = "https://datafa.st/js/script.js";
  script.async = true;
  script.defer = true;
  script.dataset.websiteId = "dfid_pFhOpbhEzeuHAKKFF418i";
  script.dataset.domain = "towbar.dev";
  document.head.appendChild(script);
})();
