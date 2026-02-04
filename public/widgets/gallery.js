// gallery.js (без import.meta, можно подключать обычным <script>)
(() => {
  // Arrow icon based on provided Frame 17.svg (this is the button shape)
  function svgArrow(dir) {
    const cls = dir === "left" ? "wgallery-arrow-icon is-left" : "wgallery-arrow-icon";
    return `
      <svg class="${cls}" viewBox="0 0 134 476" aria-hidden="true" focusable="false">
        <path d="M41 450L93.5 236L41 35.5" />
      </svg>
    `;
  }

  function normalizeSrc(src) {
    if (!src) return "";
    src = String(src).trim();

    // Accept markdown list-style lines like "- /assets/x.png"
    src = src.replace(/^[-*]\s+/, "");
    // keep absolute URLs / data / blob as-is
    if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src) || /^blob:/i.test(src)) return src;
    // IMPORTANT: resolve against site base (works for /help/... pages and GitHub Pages subpaths)
    const base = (document.body && document.body.getAttribute("data-base"))
      ? String(document.body.getAttribute("data-base"))
      : "/";
    const baseNorm = base.endsWith("/") ? base : (base + "/");

    if (src.startsWith("/")) return baseNorm + src.slice(1);
    if (src.startsWith("./")) return baseNorm + src.slice(2);
    return baseNorm + src;
  }

  function normalizeWidth(w) {
    if (!w) return "";
    w = String(w).trim();
    w = w.replace(/^width\s*[:=]\s*/i, "");
    if (/^\d+(\.\d+)?$/.test(w)) return `${w}px`;
    return w;
  }

  function normalizeAlign(a) {
    if (!a) return "";
    a = String(a).trim().toLowerCase();
    a = a.replace(/^align\s*[:=]\s*/i, "");
    if (a === "left" || a === "center" || a === "right") return a;
    return "";
  }

  function applyLayout(el, align, width) {
    el.classList.remove("align-left", "align-center", "align-right");
    el.classList.add(`align-${align || "center"}`);

    const w = normalizeWidth(width);
    if (w) {
      el.style.width = w;
      el.style.maxWidth = "100%";
    } else {
      el.style.width = "";
      el.style.maxWidth = "";
    }
  }

  function mount(el) {
    if (el.getAttribute("data-wgallery-mounted") === "1") return;
    el.setAttribute("data-wgallery-mounted", "1");

    const itemsEnc = el.getAttribute("data-items") || "";
    let items = [];
    try {
      items = JSON.parse(decodeURIComponent(itemsEnc));
    } catch {}

    if (!Array.isArray(items) || items.length === 0) {
      el.innerHTML = `<div class="wgallery-empty">Gallery: no images</div>`;
      return;
    }

    const defaultAlign = normalizeAlign(el.getAttribute("data-align")) || "center";
    const defaultWidth = normalizeWidth(el.getAttribute("data-width") || "");

    let index = 0;
    let showA = true;
    let switching = false;
    let seq = 0;

    el.innerHTML = `
      <div class="wgallery-frame">
        <div class="wgallery-viewport">
          <img class="wgallery-img img-a" alt="" loading="eager" decoding="async" />
          <img class="wgallery-img img-b" alt="" loading="eager" decoding="async" />
        </div>

        <button class="wgallery-arrow prev" type="button" aria-label="Предыдущее">
          ${svgArrow("left")}
        </button>

        <button class="wgallery-arrow next" type="button" aria-label="Следующее">
          ${svgArrow("right")}
        </button>
      </div>

      <div class="wgallery-bars" role="tablist" aria-label="Изображения"></div>
      <div class="wgallery-caption" aria-live="polite"></div>
    `;

    const viewport = el.querySelector(".wgallery-viewport");
    const imgA = el.querySelector(".img-a");
    const imgB = el.querySelector(".img-b");
    const cap = el.querySelector(".wgallery-caption");
    const bars = el.querySelector(".wgallery-bars");
    const prev = el.querySelector(".wgallery-arrow.prev");
    const next = el.querySelector(".wgallery-arrow.next");

    const barBtns = items.map((_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "wgallery-bar";
      b.setAttribute("aria-label", `Открыть ${i + 1}`);
      b.addEventListener("click", () => set(i, i > index ? 1 : -1));
      bars.appendChild(b);
      return b;
    });

    function applyActiveBars() {
      barBtns.forEach((b, bi) => b.classList.toggle("is-active", bi === index));
      const dis = items.length <= 1;
      prev.disabled = dis;
      next.disabled = dis;
    }

    function setAspectFrom(img) {
      const w = img.naturalWidth || 16;
      const h = img.naturalHeight || 9;
      viewport.style.aspectRatio = `${w} / ${h}`;
    }

    function applyForItem(it) {
      const align = normalizeAlign(it && it.align) || defaultAlign;
      const width = normalizeWidth(it && it.width) || defaultWidth;
      applyLayout(el, align, width);
    }

    function preload(i) {
      const it = items[(i + items.length) % items.length];
      if (!it || !it.src) return;
      const im = new Image();
      im.decoding = "async";
      im.loading = "eager";
      im.src = normalizeSrc(it.src);
    }

    function startTransition(incoming, outgoing) {
      incoming.classList.remove("is-active");
      void incoming.offsetWidth;
      requestAnimationFrame(() => {
        outgoing.classList.remove("is-active");
        incoming.classList.add("is-active");
      });
    }

    function finishTransition() {
      showA = !showA;
      applyActiveBars();
      preload(index + 1);
      preload(index - 1);
      switching = false;
    }

    function waitReady(img) {
      if (img.decode) return img.decode().catch(() => {});
      return new Promise((resolve) => {
        if (img.complete && img.naturalWidth) return resolve();
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });
    }

    function set(i, dir) {
      if (switching) return;
      switching = true;

      index = (i + items.length) % items.length;
      const it = items[index];

      applyForItem(it);

      const incoming = showA ? imgB : imgA;
      const outgoing = showA ? imgA : imgB;

      incoming.style.setProperty("--shift", dir > 0 ? "18px" : "-18px");
      outgoing.style.setProperty("--shift", dir > 0 ? "-18px" : "18px");

      incoming.classList.remove("is-active");
      incoming.src = normalizeSrc(it.src);
      incoming.alt = it.caption ? it.caption : `Image ${index + 1}`;
      cap.textContent = it.caption || "";

      const my = ++seq;

      waitReady(incoming).then(() => {
        if (my !== seq) return;

        setAspectFrom(incoming);
        startTransition(incoming, outgoing);

        const fallbackMs = 820;
        let done = false;

        const finalize = () => {
          if (done) return;
          done = true;
          finishTransition();
        };

        incoming.addEventListener(
            "transitionend",
            (e) => {
              if (e && e.target !== incoming) return;
              finalize();
            },
            { once: true }
        );

        setTimeout(finalize, fallbackMs);
      });

      applyActiveBars();
    }

    prev.addEventListener("click", () => set(index - 1, -1));
    next.addEventListener("click", () => set(index + 1, 1));

    el.tabIndex = 0;
    el.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") set(index - 1, -1);
      if (e.key === "ArrowRight") set(index + 1, 1);
    });

    // Initial render without animation
    const first = items[0];
    applyForItem(first);
    imgA.src = normalizeSrc(first.src);
    imgA.alt = first.caption ? first.caption : "Image 1";
    cap.textContent = first.caption || "";
    imgA.classList.add("is-active");
    index = 0;
    applyActiveBars();

    const initAspect = () => setAspectFrom(imgA);
    if (imgA.complete && imgA.naturalWidth) initAspect();
    else imgA.addEventListener("load", initAspect, { once: true });

    preload(1);
    preload(-1);
  }

  function init() {
    document.querySelectorAll(".wgallery").forEach(mount);
  }

  try {
    window.WGALLERY_INIT = init;
  } catch {}

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
