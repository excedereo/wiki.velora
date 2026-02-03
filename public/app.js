(() => {
  const root = document.documentElement;
  const body = document.body;
  const shell = document.getElementById("shell");
  const contentCard = document.getElementById("contentCard");
  const hudWhere = document.querySelector(".hud-where");
  const hudDesc = document.querySelector(".hud-desc");

  const mqlMobile = window.matchMedia("(max-width: 860px)");
  const mqlReduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  function isMobile() { return !!mqlMobile.matches; }
  function reducedMotion() { return !!mqlReduced.matches; }

  // Theme
  const THEME_KEY = "wiki.theme";
  const savedTheme = localStorage.getItem(THEME_KEY);
  const theme = (savedTheme === "light" || savedTheme === "dark") ? savedTheme : "dark";
  root.dataset.theme = theme;

  const themeToggle = document.getElementById("themeToggle");
  function applyTheme(t) {
    root.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch {}
    themeToggle?.setAttribute("aria-label", `Переключить тему (сейчас: ${t})`);
  }
  applyTheme(theme);

  themeToggle?.addEventListener("click", () => {
    const cur = root.dataset.theme === "light" ? "light" : "dark";
    applyTheme(cur === "light" ? "dark" : "light");
  });

  // Desktop sidebar collapse (mobile uses off-canvas)
  const sidebarBtn = document.getElementById("sidebarToggle");
  const SIDEBAR_KEY = "wiki.sidebar.collapsed";
  let desktopCollapsed = false;
  try { desktopCollapsed = localStorage.getItem(SIDEBAR_KEY) === "1"; } catch {}

  function applyDesktopSidebar() {
    if (!shell) return;
    shell.classList.toggle("is-collapsed", desktopCollapsed);
    sidebarBtn?.setAttribute("aria-label", desktopCollapsed ? "Развернуть меню" : "Свернуть меню");
  }

  function setDesktopCollapsed(next) {
    desktopCollapsed = !!next;
    applyDesktopSidebar();
    try { localStorage.setItem(SIDEBAR_KEY, desktopCollapsed ? "1" : "0"); } catch {}
  }

  // Mobile off-canvas
  const scrim = document.getElementById("scrim");
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  let mobileOpen = false;

  function setMobileOpen(open) {
    if (!shell) return;
    mobileOpen = !!open;
    shell.classList.toggle("is-mobile-open", mobileOpen);

    // Prevent background scroll when menu is open
    if (mobileOpen) {
      body.style.overflow = "hidden";
    } else {
      body.style.overflow = "";
    }
  }

  function syncLayoutMode() {
    if (!shell) return;
    if (isMobile()) {
      // In mobile mode the sidebar is always off-canvas; ignore desktop collapsed state.
      shell.classList.remove("is-collapsed");
      setMobileOpen(false);
    } else {
      setMobileOpen(false);
      applyDesktopSidebar();
    }
  }

  syncLayoutMode();
  mqlMobile.addEventListener?.("change", syncLayoutMode);

  // Sidebar button: desktop collapse OR mobile close
  sidebarBtn?.addEventListener("click", () => {
    if (isMobile()) {
      setMobileOpen(false);
      return;
    }
    setDesktopCollapsed(!desktopCollapsed);
  });

  // Mobile open button + scrim close
  mobileMenuBtn?.addEventListener("click", () => setMobileOpen(true));
  scrim?.addEventListener("click", () => setMobileOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mobileOpen) setMobileOpen(false);
  });

  // ---- Navigation: active link + collapsible sections + search ----

  function normalizePathname(p) {
    try { p = decodeURIComponent(p || ""); } catch {}
    return String(p || "").replace(/\/$/, "");
  }

  function updateActiveNav(pathname) {
    const curPath = normalizePathname(pathname ?? location.pathname);
    document.querySelectorAll(".nav a.is-active").forEach(a => a.classList.remove("is-active"));

    document.querySelectorAll(".nav a").forEach(a => {
      const href = a.getAttribute("href") || "";
      if (!href) return;
      // Only compare pathnames (ignore hashes/query)
      let u;
      try { u = new URL(href, location.href); } catch { return; }
      const hp = normalizePathname(u.pathname);
      if (hp && hp === curPath) a.classList.add("is-active");
    });
  }

  // Collapsible sections + search state
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

      const path = normalizePathname(item.getAttribute("data-nav-path") || "");
      const isActiveBranch = !!item.querySelector("a.is-active");

      if (isActiveBranch) {
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
        const openDefault = item.classList.contains("is-open") && !item.classList.contains("is-collapsed");
        setOpen(item, openDefault);
        return;
      }

      const isCollapsed = !!navCollapsed[path];
      setOpen(item, !isCollapsed);
    });
    saveNavState();
  }

  updateActiveNav(location.pathname);
  applySavedNavState();

  // Section head: LMB toggles children (no navigation), RMB toggles too
  document.querySelectorAll('a.nav-section[data-nav-section]').forEach(a => {
    a.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const item = a.closest(".nav-item");
      if (!item) return;
      const kids = item.querySelector(':scope > .nav-children');
      if (!kids) return;

      e.preventDefault();
      e.stopPropagation();

      const path = normalizePathname(item.getAttribute("data-nav-path") || "");
      const isOpen = item.classList.contains("is-open") && !item.classList.contains("is-collapsed");
      const nextOpen = !isOpen;
      setOpen(item, nextOpen);
      navCollapsed[path] = !nextOpen;
      saveNavState();
    });

    a.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = a.closest(".nav-item");
      if (!item) return;
      const kids = item.querySelector(':scope > .nav-children');
      if (!kids) return;

      const path = normalizePathname(item.getAttribute("data-nav-path") || "");
      const kidsVisible = getComputedStyle(kids).display !== "none";
      const isOpen = kidsVisible && item.classList.contains("is-open") && !item.classList.contains("is-collapsed");

      const nextOpen = !isOpen;
      setOpen(item, nextOpen);
      navCollapsed[path] = !nextOpen;
      saveNavState();
    });
  });

  // Sidebar search: filter menu
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

  // ---- Smart navigation (SPA-like) ----

  const cache = new Map();
  let inflight = null;

  function isSameOrigin(u) {
    return u.origin === location.origin;
  }

  function isInternalUrl(u) {
    if (!isSameOrigin(u)) return false;
    // ignore obvious file downloads (pdf, zip, images)
    const p = u.pathname.toLowerCase();
    if (p.endsWith('.pdf') || p.endsWith('.zip') || p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.webp') || p.endsWith('.svg')) return false;
    return true;
  }

  function canonicalKey(u) {
    const x = new URL(u.toString());
    x.hash = "";
    return x.toString();
  }

  async function fetchHtml(u, signal) {
    const key = canonicalKey(u);
    if (cache.has(key)) return cache.get(key);

    // Try direct fetch first
    let res = await fetch(u.toString(), { signal, credentials: 'same-origin' });

    // Some static servers are picky about directory URLs; fallback to index.html
    if (!res.ok && u.pathname.endsWith('/')) {
      const u2 = new URL(u.toString());
      u2.pathname = u2.pathname + 'index.html';
      res = await fetch(u2.toString(), { signal, credentials: 'same-origin' });
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    cache.set(key, text);
    return text;
  }

  function extractPage(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');

    const nextContentCard = doc.getElementById('contentCard') || doc.querySelector('.content-card');
    if (!nextContentCard) throw new Error('No contentCard in response');

    const nextWhere = doc.querySelector('.hud-where');
    const nextDesc = doc.querySelector('.hud-desc');

    return {
      title: doc.title || '',
      where: nextWhere ? nextWhere.textContent || '' : '',
      desc: nextDesc ? nextDesc.textContent || '' : '',
      contentHtml: nextContentCard.innerHTML,
    };
  }

  function scrollToHash(hash) {
    if (!hash) return;
    const id = hash.replace(/^#/, "");
    if (!id) return;

    // First try exact id
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      return;
    }

    // Then try anchor name
    const a = document.querySelector(`a[name="${CSS.escape(id)}"]`);
    if (a) a.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  async function applyPageData(data, url) {
    if (data.title) document.title = data.title;
    if (hudWhere) hudWhere.textContent = data.where;
    if (hudDesc) hudDesc.textContent = data.desc;

    if (contentCard) {
      contentCard.innerHTML = data.contentHtml;
    }

    // Update nav active + open state
    updateActiveNav(url.pathname);

    // If search filter is active, preserve it; else apply saved open state.
    const q = navSearch?.value || '';
    if (q.trim()) applyNavFilter(q);
    else applySavedNavState();

    // Re-init widgets inside new content
    try { window.WGALLERY_INIT?.(); } catch {}

    // Close mobile menu after navigation
    if (isMobile()) setMobileOpen(false);

    // Scroll
    if (url.hash) scrollToHash(url.hash);
    else window.scrollTo(0, 0);
  }

  function waitTransition(el) {
    if (!el || reducedMotion()) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      el.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 220);
    });
  }

  async function softNavigate(toUrl, push) {
    const url = (toUrl instanceof URL) ? toUrl : new URL(String(toUrl), location.href);
    if (!isInternalUrl(url)) {
      location.href = url.toString();
      return;
    }

    // Same document, hash-only
    const curNoHash = canonicalKey(new URL(location.href));
    const nextNoHash = canonicalKey(url);
    if (curNoHash === nextNoHash && url.hash) {
      if (push) history.pushState({}, '', url.toString());
      scrollToHash(url.hash);
      return;
    }

    // Abort previous
    try { inflight?.abort(); } catch {}
    inflight = new AbortController();

    try {
      // Load next HTML
      const htmlText = await fetchHtml(url, inflight.signal);
      const data = extractPage(htmlText);

      // Push URL before swap (so Address bar updates quickly)
      if (push) history.pushState({}, '', url.toString());

      // Animate + apply
      if (document.startViewTransition && !reducedMotion()) {
        const vt = document.startViewTransition(() => applyPageData(data, url));
        await vt.finished;
      } else {
        if (contentCard && !reducedMotion()) {
          contentCard.classList.add('is-transition-out');
          await waitTransition(contentCard);
        }

        await applyPageData(data, url);

        if (contentCard && !reducedMotion()) {
          // Start from "in" state then animate to normal
          contentCard.classList.add('is-transition-in');
          // Force style flush
          void contentCard.offsetWidth;
          requestAnimationFrame(() => {
            contentCard.classList.remove('is-transition-out');
            contentCard.classList.remove('is-transition-in');
          });
        } else {
          contentCard?.classList.remove('is-transition-out');
          contentCard?.classList.remove('is-transition-in');
        }
      }
    } catch (err) {
      // Fallback to normal navigation
      location.href = url.toString();
    }
  }

  // Click interception
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const a = e.target?.closest?.('a');
    if (!a) return;

    // Opt-outs
    if (a.hasAttribute('download')) return;
    const target = (a.getAttribute('target') || '').trim();
    if (target && target !== '_self') return;
    if (a.getAttribute('rel')?.includes('external')) return;
    if (a.getAttribute('data-no-spa') === '1') return;

    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;

    let url;
    try { url = new URL(href, location.href); } catch { return; }

    if (!isInternalUrl(url)) return;

    e.preventDefault();
    softNavigate(url, true);
  }, { passive: false });

  // Back/forward
  window.addEventListener('popstate', () => {
    softNavigate(new URL(location.href), false);
  });

  // Prefetch on hover (desktop)
  document.addEventListener('mouseover', (e) => {
    const a = e.target?.closest?.('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href) return;

    let url;
    try { url = new URL(href, location.href); } catch { return; }
    if (!isInternalUrl(url)) return;

    // Fire and forget
    const key = canonicalKey(url);
    if (cache.has(key)) return;
    const ctrl = new AbortController();
    fetchHtml(url, ctrl.signal).catch(() => {});
  });

})();
