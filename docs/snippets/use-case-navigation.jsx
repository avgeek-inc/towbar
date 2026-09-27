export const UseCaseNavigation = () => {
  useLayoutEffect(() => {
    const storageKey = "towbar-use-case-open-groups";
    const groupSelector = "#sidebar li[data-title] > button[aria-expanded]";
    let restoring = false;
    let frame = 0;

    function storedGroups() {
      try {
        return new Set(JSON.parse(sessionStorage.getItem(storageKey) || "[]"));
      } catch {
        return new Set();
      }
    }

    function save(groups) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify([...groups]));
      } catch {
        // The sidebar still works if browser storage is unavailable.
      }
    }

    function groupName(button) {
      return button.parentElement?.dataset.title;
    }

    function rememberOpenGroups() {
      const groups = new Set();
      for (const button of document.querySelectorAll(groupSelector)) {
        if (button.getAttribute("aria-expanded") === "true") {
          const name = groupName(button);
          if (name) groups.add(name);
        }
      }
      save(groups);
    }

    function restoreOpenGroups() {
      frame = 0;
      const groups = storedGroups();
      if (!groups.size) return;
      restoring = true;
      for (const button of document.querySelectorAll(groupSelector)) {
        if (
          groups.has(groupName(button)) &&
          button.getAttribute("aria-expanded") === "false"
        ) {
          button.click();
        }
      }
      restoring = false;
    }

    function scheduleRestore() {
      if (!frame) frame = requestAnimationFrame(restoreOpenGroups);
    }

    function onClick(event) {
      if (restoring || !(event.target instanceof Element)) return;
      const button = event.target.closest(groupSelector);
      if (button) {
        const name = groupName(button);
        if (!name) return;
        const groups = storedGroups();
        if (button.getAttribute("aria-expanded") === "true")
          groups.delete(name);
        else groups.add(name);
        save(groups);
        return;
      }
      if (event.target.closest('a[href^="/docs/use-cases/"]')) {
        rememberOpenGroups();
      }
    }

    const observer = new MutationObserver(scheduleRestore);
    document.addEventListener("click", onClick, true);
    observer.observe(document.getElementById("sidebar") || document.body, {
      childList: true,
      subtree: true,
    });
    scheduleRestore();
    return () => {
      document.removeEventListener("click", onClick, true);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
};
