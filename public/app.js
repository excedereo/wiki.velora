(() => {
  const root = document.documentElement;

  // Theme
  const THEME_KEY = "wiki.theme";
  const savedTheme = localStorage.getItem(THEME_KEY);
  const theme = (savedTheme === "light" || savedTheme === "dark") ? savedTheme : "dark";
  root.dataset.theme = theme;

  const themeToggle = document.getElementById("themeToggle");

  function applyTheme(t) {
    root.dataset.theme = t;
    localStorage.setItem(THEME_KEY, t);
    themeToggle?.setAttribute("aria-label", `Переключить тему (сейчас: ${t})`);
  }
  applyTheme(theme);

  themeToggle?.addEventListener("click", () => {
    const cur = root.dataset.theme === "light" ? "light" : "dark";
    applyTheme(cur === "light" ? "dark" : "light");
  });

  // Sidebar collapse
  const shell = document.getElementById("shell");
  const sidebarBtn = document.getElementById("sidebarToggle");

  const SIDEBAR_KEY = "wiki.sidebar.collapsed";

  function applySidebar(collapsed) {
    shell?.classList.toggle("is-collapsed", collapsed);
    sidebarBtn?.setAttribute("aria-label", collapsed ? "Развернуть меню" : "Свернуть меню");
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }
  applySidebar(localStorage.getItem(SIDEBAR_KEY) === "1");

  sidebarBtn?.addEventListener("click", () => {
    const isCollapsed = shell?.classList.contains("is-collapsed");
    applySidebar(!isCollapsed);
  });

  // Active link highlight
  const curPath = decodeURIComponent(location.pathname.replace(/\/$/, ""));
  document.querySelectorAll(".nav a").forEach(a => {
    const href = decodeURIComponent((a.getAttribute("href") || "")).replace(/\/$/, "");
    if (href && href === curPath) a.classList.add("is-active");
  });

  // Collapsible sections + search
  const NAV_STATE_KEY = "wiki.nav.collapsed.v1";
  let navCollapsed = {};
  try { navCollapsed = JSON.parse(localStorage.getItem(NAV_STATE_KEY) || "{}") || {}; } catch { navCollapsed = {}; }

  function saveNavState() {
    try { localStorage.setItem(NAV_STATE_KEY, JSON.stringify(navCollapsed)); } catch {}
  }

  function setOpen(item, open) {
    item.classList.toggle("is-open", !!open);
    item.classList.toggle("is-collapsed", !open);
    const head = item.querySelector(':scope > a.nav-section[data-nav-section]');
    if (head) head.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function applySavedNavState() {
    document.querySelectorAll(".nav-item[data-nav-path]").forEach(item => {
      item.style.display = "";
      const kids = item.querySelector(':scope > .nav-children');
      if (!kids) return;

      const path = decodeURIComponent(item.getAttribute("data-nav-path") || "");
      const isActiveBranch = !!item.querySelector("a.is-active");

      if (isActiveBranch) {
        // Активную ветку тоже можно принудительно свернуть (ПКМ): если пользователь явно свернул — уважаем это.
        const forcedCollapsed = Object.prototype.hasOwnProperty.call(navCollapsed, path) && !!navCollapsed[path];
        if (forcedCollapsed) {
          setOpen(item, false);
        } else {
          setOpen(item, true);
          navCollapsed[path] = false;
        }
        return;
      }

      const hasKey = Object.prototype.hasOwnProperty.call(navCollapsed, path);
      if (!hasKey) {
        // Respect server-side default (collapsed by default, open for active branch)
        const openDefault = item.classList.contains("is-open") && !item.classList.contains("is-collapsed");
        setOpen(item, openDefault);
        return;
      }

      const isCollapsed = !!navCollapsed[path];
      setOpen(item, !isCollapsed);
    });
    saveNavState();
  }

  applySavedNavState();

  // Заголовок раздела: ЛКМ и ПКМ — тумблер раскрытия/сворачивания (для разделов с дочерними страницами)
  document.querySelectorAll('a.nav-section[data-nav-section]').forEach(a => {
    // ЛКМ: раскрыть/свернуть, без перехода на страницу раздела
    a.addEventListener("click", (e) => {
      // Уважаем модификаторы (Ctrl/Cmd/Shift и т.п.) — так можно открыть ссылку в новой вкладке
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const item = a.closest(".nav-item");
      if (!item) return;
      const kids = item.querySelector(':scope > .nav-children');
      if (!kids) return; // если нет детей — это обычная ссылка

      e.preventDefault();
      e.stopPropagation();

      const path = decodeURIComponent(item.getAttribute("data-nav-path") || "");
      const isOpen = item.classList.contains("is-open") && !item.classList.contains("is-collapsed");
      const nextOpen = !isOpen;
      setOpen(item, nextOpen);
      navCollapsed[path] = !nextOpen;
      saveNavState();
    });

    // ПКМ: раскрыть/свернуть вместо перехода
    a.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = a.closest(".nav-item");
      if (!item) return;
      const kids = item.querySelector(':scope > .nav-children');
      if (!kids) return;

      const path = decodeURIComponent(item.getAttribute("data-nav-path") || "");

      // Надёжный тумблер: считаем «открыто», если дети реально видимы
      const kidsVisible = getComputedStyle(kids).display !== "none";
      const isOpen = kidsVisible && item.classList.contains("is-open") && !item.classList.contains("is-collapsed");

      const nextOpen = !isOpen;          // ПКМ должен и раскрывать, и скрывать обратно
      setOpen(item, nextOpen);
      navCollapsed[path] = !nextOpen;
      saveNavState();
    });
  });

  // Sidebar search: фильтрация пунктов меню
  const navSearch = document.getElementById("navSearch");
  function applyNavFilter(raw) {
    const q = (raw || "").trim().toLowerCase();
    if (!q) {
      applySavedNavState();
      return;
    }

    document.querySelectorAll(".nav-item[data-nav-path]").forEach(item => {
      const head = item.querySelector(':scope > .nav-link');
      const headText = (head?.textContent || "").toLowerCase();

      let match = headText.includes(q);

      if (!match) {
        const links = item.querySelectorAll(".nav-children a.nav-link");
        for (const a of links) {
          if (((a.textContent || "").toLowerCase()).includes(q)) { match = true; break; }
        }
      }

      item.style.display = match ? "" : "none";

      const kids = item.querySelector(':scope > .nav-children');
      if (kids && match) setOpen(item, true);
    });
  }

  navSearch?.addEventListener("input", () => applyNavFilter(navSearch.value));
  navSearch?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      navSearch.value = "";
      applyNavFilter("");
      navSearch.blur();
    }
  });

})();
