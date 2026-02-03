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

  function mount(el) {
    const itemsEnc = el.getAttribute("data-items") || "";
    let items = [];
    try { items = JSON.parse(decodeURIComponent(itemsEnc)); } catch {}

    if (!Array.isArray(items) || items.length === 0) {
      el.innerHTML = `<div class="wgallery-empty">Gallery: no images</div>`;
      return;
    }

    const align = el.getAttribute("data-align") || "center";
    const width = el.getAttribute("data-width") || "";

    el.classList.add(`align-${align}`);
    if (width) el.style.maxWidth = `${Number(width)}px`;

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

    function preload(i) {
      const it = items[(i + items.length) % items.length];
      if (!it || !it.src) return;
      const im = new Image();
      im.decoding = "async";
      im.loading = "eager";
      im.src = it.src;
    }

    function startTransition(incoming, outgoing) {
      // Ensure the browser registers the initial shifted/hidden state
      incoming.classList.remove("is-active");
      // Flush layout so cached images still animate (prevents 'jump cut')
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
      // decode() forces async decode; good for cached images too
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

      const incoming = showA ? imgB : imgA;
      const outgoing = showA ? imgA : imgB;

      // Small slide + fade (subtle, not a full swipe)
      incoming.style.setProperty("--shift", dir > 0 ? "18px" : "-18px");
      outgoing.style.setProperty("--shift", dir > 0 ? "-18px" : "18px");

      incoming.classList.remove("is-active");
      incoming.src = it.src;
      incoming.alt = it.caption ? it.caption : `Image ${index + 1}`;
      cap.textContent = it.caption || "";

      const my = ++seq;

      waitReady(incoming).then(() => {
        if (my !== seq) return;

        setAspectFrom(incoming);
        startTransition(incoming, outgoing);

        // Release the lock on transition end (with a safe fallback)
        const fallbackMs = 820; // must be > CSS duration
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
    imgA.src = first.src;
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
