import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTree, buildRoutes } from "./content.js";
import { renderMarkdown } from "./markdown.js";
import { SectionNode, PageNode } from "./types.js";

// Resolve project root reliably (works from src/ or compiled dist/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const OUT_DIR = path.resolve(ROOT_DIR, "site");

// GitHub Pages project sites are often served under /<repo>/.
// You can set BASE_PATH="/repo/" in CI, or leave empty for custom domains.
const BASE_PATH = normalizeBase(process.env.BASE_PATH || "");

// ---------- tiny template helpers ----------
function loadTemplate(name: string) {
  return fs.readFileSync(path.resolve(ROOT_DIR, "templates", name), "utf-8");
}
function tpl(s: string, vars: Record<string, string>) {
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}
function escapeHtml(s: string) {
  return s.replace(/[&<"'>]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] as string));
}

function normalizeBase(b: string): string {
  b = String(b || "").trim();
  // Default to "/" so asset links remain absolute on local preview and custom domains.
  if (!b) return "/";
  if (!b.startsWith("/")) b = "/" + b;
  if (!b.endsWith("/")) b = b + "/";
  return b;
}
function withBase(url: string): string {
  const u = String(url || "");
  if (!u) return u;
  if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("//")) return u;
  if (u.startsWith("/")) return BASE_PATH + u.slice(1);
  return BASE_PATH + u;
}
function prettyHref(urlPath: string): string {
  // convert "/a/b" -> "/a/b/" so GitHub Pages resolves index.html
  const p = String(urlPath || "");
  if (!p || p === "/") return withBase("/");
  return withBase(p.endsWith("/") ? p : p + "/");
}

function applyBaseToHtml(html: string): string {
  // Rewrite absolute root links like href="/x" -> href="/wiki.velora/x" for GitHub Pages.
  if (!BASE_PATH || BASE_PATH === "/") return html;
  return String(html || "").replace(/\b(href|src)=(["'])\/(?!\/)/g, `$1=$2${BASE_PATH}`);
}


// ---------- icon + header helpers (copied from server with small tweaks) ----------
function safeCssSize(input: unknown): string {
  const v = String(input ?? "").trim();
  if (!v) return "";
  if (/^\d+(?:\.\d+)?$/.test(v)) return `${v}px`;
  if (/^\d+(?:\.\d+)?(px|%|vw|vh|rem|em)$/.test(v)) return v;
  return "";
}

const ICON_DIR = path.resolve(ROOT_DIR, "public", "assets", "icons");
const iconFileCache = new Map<string, string | null>();
function iconFileUrl(name: string): string | null {
  const key = name.trim();
  if (!key) return null;
  if (iconFileCache.has(key)) return iconFileCache.get(key) as any;
  const svgPath = path.resolve(ICON_DIR, key + ".svg");
  const pngPath = path.resolve(ICON_DIR, key + ".png");
  const jpgPath = path.resolve(ICON_DIR, key + ".jpg");
  const jpegPath = path.resolve(ICON_DIR, key + ".jpeg");
  let url: string | null = null;
  try {
    if (fs.existsSync(svgPath)) url = withBase(`/assets/icons/${key}.svg`);
    else if (fs.existsSync(pngPath)) url = withBase(`/assets/icons/${key}.png`);
    else if (fs.existsSync(jpgPath)) url = withBase(`/assets/icons/${key}.jpg`);
    else if (fs.existsSync(jpegPath)) url = withBase(`/assets/icons/${key}.jpeg`);
  } catch {
    url = null;
  }
  iconFileCache.set(key, url);
  return url;
}

function iconSvg(name: string): string {
  const common = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const map: Record<string, string> = {
    home: `<svg class="nav-icon-svg" ${common} aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.8V20h14v-9.2"/></svg>`,
    book: `<svg class="nav-icon-svg" ${common} aria-hidden="true"><path d="M4 19.5V6a2 2 0 0 1 2-2h6v17H6a2 2 0 0 1-2-2.5Z"/><path d="M20 19.5V6a2 2 0 0 0-2-2h-6v17h6a2 2 0 0 0 2-1.5Z"/></svg>`,
    image: `<svg class="nav-icon-svg" ${common} aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="m8 14 2-2 3 3 3-4 3 4"/></svg>`,
    spark: `<svg class="nav-icon-svg" ${common} aria-hidden="true"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4 12h4"/><path d="M16 12h4"/><path d="m5 5 3 3"/><path d="m16 16 3 3"/><path d="m19 5-3 3"/><path d="m8 16-3 3"/><path d="M12 8a4 4 0 1 0 0 8"/></svg>`,
    file: `<svg class="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`,
    folder: `<svg class="nav-icon-svg" ${common} aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`,
  };
  return map[name] || map.folder;
}

function renderIconAny(rawIcon: unknown, cls: string): string {
  const raw = typeof rawIcon === "string" ? rawIcon.trim() : "";
  if (!raw) return "";
  // explicit path
  if (raw.includes("/")) {
    const fixed = raw.startsWith("/") ? withBase(raw) : raw;
    return `<span class="${escapeHtml(cls)}" aria-hidden="true"><img src="${escapeHtml(fixed)}" alt="" loading="eager" decoding="async" /></span>`;
  }
  const url = iconFileUrl(raw);
  if (url) {
    return `<span class="${escapeHtml(cls)}" aria-hidden="true"><img src="${escapeHtml(url)}" alt="" loading="eager" decoding="async" /></span>`;
  }
  return `<span class="${escapeHtml(cls)}" aria-hidden="true">${iconSvg(raw)}</span>`;
}

function renderHeader(meta: Record<string, unknown>, fallbackAlt: string): string {
  const headerSrcRaw = String(
    (meta.header as any) ??
    (meta.headerImage as any) ??
    (meta.header_image as any) ??
    (meta.hero as any) ??
    ""
  ).trim();
  if (!headerSrcRaw) return "";
  const headerSrc = headerSrcRaw.startsWith("/") ? withBase(headerSrcRaw) : headerSrcRaw;

  const alt = String(
    (meta.headerAlt as any) ??
    (meta.header_alt as any) ??
    (meta.heroAlt as any) ??
    fallbackAlt ??
    ""
  ).trim();

  const height = safeCssSize((meta.headerHeight as any) ?? (meta.header_height as any) ?? (meta.heroHeight as any));
  const fitRaw = String((meta.headerFit as any) ?? (meta.header_fit as any) ?? (meta.heroFit as any) ?? "cover").trim();
  const fit = (fitRaw === "contain" || fitRaw === "cover") ? fitRaw : "cover";
  const posRaw = String((meta.headerPos as any) ?? (meta.header_pos as any) ?? (meta.headerPosition as any) ?? "center").trim();
  const pos = (/^(center|top|bottom|left|right)(\s+(center|top|bottom|left|right))?$/.test(posRaw)) ? posRaw : "center";

  const styleParts: string[] = [`--header-fit:${fit}`, `--header-pos:${pos}`];
  if (height) styleParts.push(`--header-h:${height}`);
  const styleAttr = styleParts.length ? ` style="${escapeHtml(styleParts.join(";"))}"` : "";

  return `<div class="page-header"${styleAttr}><img src="${escapeHtml(headerSrc)}" alt="${escapeHtml(alt)}" loading="eager" decoding="async" /></div>`;
}

// ---------- navigation + breadcrumbs (simplified but keeps markup/classes) ----------
function findBreadcrumbTitles(tree: SectionNode, urlPath: string): string[] {
  const target = urlPath.replace(/\/$/, "");
  const out: string[] = [];
  function walk(sec: SectionNode, trail: string[]): boolean {
    // index page matches
    if (sec.indexPage && sec.indexPage.path.replace(/\/$/, "") === target) {
      out.push(...trail, sec.title, sec.indexPage.title);
      return true;
    }
    for (const ch of sec.children) {
      if (ch.type === "page") {
        if (ch.path.replace(/\/$/, "") === target) {
          out.push(...trail, sec.title, ch.title);
          return true;
        }
      } else {
        if (walk(ch, [...trail, sec.title])) return true;
      }
    }
    return false;
  }
  for (const top of tree.children) walk(top as SectionNode, []);
  // remove possible leading "root"
  return out.filter(Boolean).filter(t => t !== "root");
}

function findSectionForIndexPage(tree: SectionNode, page: PageNode): SectionNode | null {
  function walk(sec: SectionNode): SectionNode | null {
    if (sec.indexPage && sec.indexPage.filePath === page.filePath) return sec;
    for (const ch of sec.children) {
      if (ch.type === "section") {
        const r = walk(ch);
        if (r) return r;
      }
    }
    return null;
  }
  for (const top of tree.children) {
    const r = walk(top as SectionNode);
    if (r) return r;
  }
  return null;
}

function renderSectionListing(sec: SectionNode): string {
  const esc = escapeHtml;
  const cards: string[] = [];

  for (const ch of sec.children) {
    if (ch.type === "page") {
      if (sec.indexPage && sec.indexPage.filePath === ch.filePath) continue;

      const href = prettyHref(ch.path);
      cards.push(
          `<a class="sec-card" href="${esc(href)}">` +
          `<div class="sec-top"><span class="sec-badge">СТРАНИЦА</span><span class="sec-meta">${esc(ch.slug)}</span></div>` +
          `<div class="sec-title">${esc(ch.title)}</div>` +
          `</a>`
      );
    } else {
      const href = ch.indexPage ? prettyHref(ch.indexPage.path) : prettyHref(ch.path);
      cards.push(
          `<a class="sec-card" href="${esc(href)}">` +
          `<div class="sec-top"><span class="sec-badge">РАЗДЕЛ</span><span class="sec-meta">${esc(ch.slug)}</span></div>` +
          `<div class="sec-title">${esc(ch.title)}</div>` +
          `</a>`
      );
    }
  }

  if (!cards.length) return "";
  return `<section class="sec-list"><div class="sec-head">Содержание</div><div class="sec-grid">${cards.join("")}</div></section>`;
}

function renderNav(tree: SectionNode, activePath: string = ""): string {
  const esc = escapeHtml;
  const active = decodeURIComponent((activePath || "").replace(/\/$/, ""));

  function inferIconName(slug: string, title: string): string {
    const s = (slug || "").toLowerCase();
    const t = (title || "").toLowerCase();
    if (s.includes("home") || t.includes("глав")) return "home";
    if (s.includes("demo") || t.includes("демо")) return "spark";
    if (s.includes("gallery") || t.includes("галер")) return "image";
    if (s.includes("doc") || s.includes("section") || t.includes("раздел") || t.includes("док")) return "book";
    return "folder";
  }

  function inferPageIconName(slug: string, title: string): string {
    const s = (slug || "").toLowerCase();
    const t = (title || "").toLowerCase();
    if (s.includes("install") || t.includes("установ")) return "spark";
    if (s.includes("faq") || t.includes("вопрос")) return "file";
    return "file";
  }

  function renderSectionIcon(node: SectionNode): string {
    const raw = typeof node.meta?.icon === "string" ? String(node.meta.icon).trim() : "";
    if (raw) return renderIconAny(raw, "nav-icon");
    return `<span class="nav-icon" aria-hidden="true">${iconSvg(inferIconName(node.slug, node.title))}</span>`;
  }

  function renderPageIcon(node: PageNode): string {
    const raw = typeof node.meta?.icon === "string" ? String(node.meta.icon).trim() : "";
    if (raw) return renderIconAny(raw, "nav-icon");
    return `<span class="nav-icon" aria-hidden="true">${iconSvg(inferPageIconName(node.slug, node.title))}</span>`;
  }

  function link(title: string, href: string, depth: number, cls: string, extra: string = "") {
    const outHref = prettyHref(href);
    return `<a class="nav-link ${cls} d-${depth}" href="${esc(outHref)}">${extra}<span class="nav-text">${esc(title)}</span></a>`;
  }

  function sectionHead(node: SectionNode, depth: number, isOpen: boolean, hasKids: boolean) {
    const caret = hasKids
      ? `<span class="nav-caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5.5 16 12l-7 6.5"/></svg></span>`
      : "";
    const ariaExpanded = hasKids ? ` aria-expanded="${isOpen ? "true" : "false"}"` : "";

    const href = node.indexPage ? node.indexPage.path : node.path;
    return `<a class="nav-link nav-section d-${depth}" href="${esc(prettyHref(href))}" data-nav-section="${encodeURI(node.path)}"${ariaExpanded}>${renderSectionIcon(node)}<span class="nav-text">${esc(node.title)}</span>${caret}</a>`;
  }

  function label(title: string, depth: number) {
    return `<div class="nav-link nav-label d-${depth}"><span class="nav-text">${esc(title)}</span></div>`;
  }

  function nodeHtml(node: SectionNode | PageNode, depth: number): string {
    if (node.type === "page") {
      return link(node.title, node.path, depth, "nav-page", renderPageIcon(node));
    }

    const hasKids = node.children.length > 0;
    const isOpen = !!active && (active === node.path || active.startsWith(node.path + "/"));

    const head = node.indexPage
      ? sectionHead(node, depth, isOpen, hasKids)
      : label(node.title, depth);

    const kids = node.children.map(c => nodeHtml(c as any, depth + 1)).join("");
    const kidsWrap = kids ? `<div class="nav-children">${kids}</div>` : "";

    const stateCls = hasKids ? (isOpen ? "is-open" : "is-collapsed") : "is-leaf";
    const wrap = `<div class="nav-item ${stateCls}" data-nav-path="${encodeURI(node.path)}">${head}${kidsWrap}</div>`;

    if (depth === 0) return `<div class="nav-block">${wrap}</div>`;
    return wrap;
  }

  return `<nav class="nav">${tree.children.map(n => nodeHtml(n as any, 0)).join("")}</nav>`;
}

// ---------- file writing ----------
function rmrf(p: string) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}
function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}
function writeFile(p: string, content: string) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content);
}

function urlToOutPath(urlPath: string): string {
  // "/a/b" -> OUT_DIR/a/b/index.html
  const clean = urlPath.replace(/\/$/, "");
  if (!clean || clean === "/") return path.join(OUT_DIR, "index.html");
  const parts = clean.split("/").filter(Boolean).map(p => decodeURIComponent(p));
  return path.join(OUT_DIR, ...parts, "index.html");
}

function copyDir(src: string, dst: string) {
  ensureDir(dst);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

// ---------- main ----------
const tree = buildTree();
const routesArr = buildRoutes(tree);
const routes = new Map(routesArr.map(r => [r.urlPath.replace(/\/$/, ""), r.node]));

const layoutT = loadTemplate("layout.html");
const pageT = loadTemplate("page.html");

// rebuild OUT_DIR
rmrf(OUT_DIR);
ensureDir(OUT_DIR);

// copy public assets
copyDir(path.resolve(ROOT_DIR, "public"), OUT_DIR);

// create main pages
for (const [urlPathRaw, node] of routes.entries()) {
  const urlPath = urlPathRaw || "/";
  const { html: bodyHtmlRaw, meta } = renderMarkdown(node.filePath);
  const bodyHtml = applyBaseToHtml(bodyHtmlRaw);
  const pageTitle = (meta.title as string) || node.title;

  const header = renderHeader(meta as any, pageTitle);

  const crumbs = findBreadcrumbTitles(tree, urlPath);
  const where = (crumbs.length ? crumbs.join(" / ") : "Wiki");
  const desc = String((meta as any).desc ?? (meta as any).description ?? "").trim();

  const sec = findSectionForIndexPage(tree, node);
  const listing = sec ? renderSectionListing(sec) : "";

  const hideTitle = Boolean((meta as any).hideTitle ?? (meta as any).hide_title ?? (meta as any).noTitle ?? (meta as any).no_title ?? false) ||
    ((meta as any).showTitle === false) || ((meta as any).show_title === false);

  const titleIcon = renderIconAny((meta as any).icon ?? "", "page-title-icon");
  const titleBlock = hideTitle ? "" : `<div class="page-title">${titleIcon}<h1>${escapeHtml(pageTitle)}</h1></div>`;

  const content = tpl(pageT, { header, titleBlock, body: bodyHtml + listing });

  const html = tpl(layoutT, {
    title: escapeHtml(pageTitle),
    nav: renderNav(tree, urlPath),
    content,
    where: escapeHtml(where),
    desc: escapeHtml(desc),
    base: BASE_PATH, // used by templates
  });

  writeFile(urlToOutPath(urlPath), html);
}

// root index.html: redirect to first section/index (for nice entry point)
(function writeRootRedirect() {
  let dest: string | null = null;
  const first = tree.children[0] as SectionNode | undefined;
  if (first) dest = first.indexPage ? first.indexPage.path : first.path;
  if (!dest) return;

  const to = prettyHref(dest);
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${escapeHtml(to)}"><link rel="canonical" href="${escapeHtml(to)}"><script>location.replace(${JSON.stringify(to)})</script><title>Redirect</title>`;
  writeFile(path.join(OUT_DIR, "index.html"), html);
})();

// 404 page
(function write404() {
  const html = tpl(layoutT, {
    title: "404",
    nav: renderNav(tree, "/404"),
    content: "<article class=\"page\"><div class=\"page-title\"><h1>404</h1></div><div class=\"page-body\"><p>Страница не найдена</p></div></article>",
    where: "Wiki / 404",
    desc: "",
    base: BASE_PATH,
  });
  writeFile(path.join(OUT_DIR, "404.html"), html);
})();

console.log(`✅ Static site generated into: ${OUT_DIR}`);
console.log(`BASE_PATH=${BASE_PATH || "(empty)"}`);
