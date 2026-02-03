import express from "express";
import type { Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTree, buildRoutes } from "./content.js";
import { renderMarkdown } from "./markdown.js";
import { SectionNode, PageNode } from "./types.js";

// Делает запуск надёжным вне зависимости от текущей папки (cwd).
// Можно запускать хоть из корня, хоть из `dist/`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Same base-path logic as the static generator.
// In GitHub Pages project sites, assets & links must be prefixed with "/<repo>/".
const BASE_PATH = normalizeBase(process.env.BASE_PATH || "");

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
  const p = String(urlPath || "");
  if (!p || p === "/") return withBase("/");
  return withBase(p.endsWith("/") ? p : p + "/");
}
function applyBaseToHtml(html: string): string {
  if (!BASE_PATH || BASE_PATH === "/") return html;
  return String(html || "").replace(/\b(href|src)=(["'])\/(?!\/)/g, `$1=$2${BASE_PATH}`);
}


const app = express();
app.use(express.static(path.resolve(ROOT_DIR, "public")));

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

function safeCssSize(input: unknown): string {
  const v = String(input ?? "").trim();
  if (!v) return "";
  if (/^\d+(?:\.\d+)?$/.test(v)) return `${v}px`;
  if (/^\d+(?:\.\d+)?(px|%|vw|vh|rem|em)$/.test(v)) return v;
  return "";
}

// Icons (shared between nav and title)
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
    if (fs.existsSync(svgPath)) url = `/assets/icons/${key}.svg`;
    else if (fs.existsSync(pngPath)) url = `/assets/icons/${key}.png`;
    else if (fs.existsSync(jpgPath)) url = `/assets/icons/${key}.jpg`;
    else if (fs.existsSync(jpegPath)) url = `/assets/icons/${key}.jpeg`;
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
    return `<span class="${escapeHtml(cls)}" aria-hidden="true"><img src="${escapeHtml(raw)}" alt="" loading="eager" decoding="async" /></span>`;
  }
  const url = iconFileUrl(raw);
  if (url) {
    return `<span class="${escapeHtml(cls)}" aria-hidden="true"><img src="${escapeHtml(url)}" alt="" loading="eager" decoding="async" /></span>`;
  }
  // fallback to built-in svg name
  return `<span class="${escapeHtml(cls)}" aria-hidden="true">${iconSvg(raw)}</span>`;
}

function renderHeader(meta: Record<string, unknown>, fallbackAlt: string): string {
  const headerSrc = String(
    (meta.header as any) ??
    (meta.headerImage as any) ??
    (meta.header_image as any) ??
    (meta.hero as any) ??
    ""
  ).trim();
  if (!headerSrc) return "";

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

  function renderIcon(node: SectionNode): string {
    const raw = typeof node.meta?.icon === "string" ? String(node.meta.icon).trim() : "";
    if (raw && raw.includes("/")) {
      return `<span class="nav-icon" aria-hidden="true"><img src="${esc(raw)}" alt="" loading="lazy" decoding="async" /></span>`;
    }
    if (raw) {
      const url = iconFileUrl(raw);
      if (url) return `<span class="nav-icon" aria-hidden="true"><img src="${esc(url)}" alt="" loading="lazy" decoding="async" /></span>`;
    }
    const name = raw && !raw.includes("/") ? raw : inferIconName(node.slug, node.title);
    const svg = iconSvg(name);
    return `<span class="nav-icon" aria-hidden="true">${svg}</span>`;
  }

  

function inferPageIconName(slug: string, title: string): string {
  const s = (slug || "").toLowerCase();
  const t = (title || "").toLowerCase();
  if (s.includes("install") || t.includes("установ")) return "spark";
  if (s.includes("faq") || t.includes("вопрос")) return "file";
  return "file";
}

function renderPageIcon(node: PageNode): string {
  const raw = typeof node.meta?.icon === "string" ? String(node.meta.icon).trim() : "";
  if (raw && raw.includes("/")) {
    return `<span class="nav-icon" aria-hidden="true"><img src="${esc(raw)}" alt="" loading="lazy" decoding="async" /></span>`;
  }
  if (raw) {
    const url = iconFileUrl(raw);
    if (url) return `<span class="nav-icon" aria-hidden="true"><img src="${esc(url)}" alt="" loading="lazy" decoding="async" /></span>`;
    // if it's a known built-in svg name
    return `<span class="nav-icon" aria-hidden="true">${iconSvg(raw)}</span>`;
  }
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
    return `<a class="nav-link nav-section d-${depth}" href="${encodeURI(node.path)}" data-nav-section="${encodeURI(node.path)}"${ariaExpanded}>${renderIcon(node)}<span class="nav-text">${esc(node.title)}</span>${caret}</a>`;
  }

  function label(title: string, depth: number) {
    return `<div class="nav-link nav-label d-${depth}"><span class="nav-text">${esc(title)}</span></div>`;
  }

  function nodeHtml(node: SectionNode | PageNode, depth: number): string {
    if (node.type === "page") return link(node.title, node.path, depth, "nav-page", renderPageIcon(node));

    const hasKids = node.children.length > 0;
    const isOpen = !!active && (active === node.path || active.startsWith(node.path + "/"));

    const head = node.indexPage
      ? sectionHead(node, depth, isOpen, hasKids)
      : label(node.title, depth);

    const kids = node.children.map(c => nodeHtml(c, depth + 1)).join("");
    const kidsWrap = kids ? `<div class="nav-children">${kids}</div>` : "";

    const stateCls = hasKids ? (isOpen ? "is-open" : "is-collapsed") : "is-leaf";
    const wrap = `<div class="nav-item ${stateCls}" data-nav-path="${encodeURI(node.path)}">${head}${kidsWrap}</div>`;

    if (depth === 0) return `<div class="nav-block">${wrap}</div>`;
    return wrap;
  }

  return `<nav class="nav">${tree.children.map(n => nodeHtml(n, 0)).join("")}</nav>`;
}

function findBreadcrumbTitles(tree: SectionNode, urlPath: string): string[] {
  const segs = urlPath.split("/").filter(Boolean);
  const titles: string[] = [];
  let cur: SectionNode = tree;

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];

    const sec = cur.children.find(c => c.type === "section" && c.slug === seg) as SectionNode | undefined;
    if (sec) {
      titles.push(sec.title);
      cur = sec;
      continue;
    }

    const page = cur.children.find(c => c.type === "page" && c.slug === seg) as PageNode | undefined;
    if (page) {
      titles.push(page.title);
      break;
    }

    titles.push(seg);
  }

  return titles;
}

function findSectionForIndexPage(tree: SectionNode, page: PageNode): SectionNode | null {
  let found: SectionNode | null = null;

  function walk(sec: SectionNode) {
    if (sec.indexPage && (sec.indexPage.filePath === page.filePath || sec.indexPage.path === page.path)) {
      found = sec;
      return;
    }
    for (const ch of sec.children) {
      if (ch.type === "section") {
        walk(ch);
        if (found) return;
      }
    }
  }

  walk(tree);
  return found;
}

function renderSectionListing(sec: SectionNode): string {
  if (!sec.children.length) return "";

  const cards = sec.children.map(ch => {
    const isSection = ch.type === "section";
    const href = ch.path;
    const label = isSection ? "Раздел" : "Страница";
    const meta = isSection ? `${(ch as SectionNode).children.length} элементов` : "Markdown";

    return `
      <a class="sec-card" href="${encodeURI(href)}">
        <div class="sec-top">
          <span class="sec-badge">${escapeHtml(label)}</span>
          <span class="sec-meta">${escapeHtml(meta)}</span>
        </div>
        <div class="sec-title">${escapeHtml(ch.title)}</div>
      </a>
    `;
  }).join("");

  return `
    <section class="sec-list">
      <h2 class="sec-head">Содержимое</h2>
      <div class="sec-grid">${cards}</div>
    </section>
  `;
}

const layoutT = loadTemplate("layout.html");
const pageT = loadTemplate("page.html");

const tree = buildTree();
const routes = new Map(buildRoutes(tree).map(r => [r.urlPath, r.node]));

app.get("/", (req: Request, res: Response) => {
  // Determine a sensible default home page. If the first top-level section
  // has an index page, redirect to it; otherwise redirect to the section
  // itself. This avoids hard-coding a particular slug like "/Главная".
  let dest: string | null = null;
  const first = tree.children[0] as SectionNode | undefined;
  if (first) {
    dest = first.indexPage ? first.indexPage.path : first.path;
  }
  if (dest && routes.get(dest)) {
    return res.redirect(encodeURI(dest));
  }
  // Fallback: show a blank home page with instructions
  const html = tpl(layoutT, {
    title: "Wiki",
    nav: renderNav(tree, req.path),
    content: "<h1>Wiki</h1><p>Создай первую страницу в папке content</p>",
    where: "Wiki",
    desc: "",
    base: BASE_PATH,
  });
  res.send(html);
});

app.get("*", (req: Request, res: Response) => {
  const rawPath = req.path.endsWith("/") && req.path !== "/" ? req.path.slice(0, -1) : req.path;
  const urlPath = decodeURIComponent(rawPath);

  const node = routes.get(urlPath);
  if (!node) {
    const html = tpl(layoutT, {
      title: "404",
      nav: renderNav(tree, req.path),
      content: "<h1>404</h1><p>Страница не найдена</p>",
      where: "Wiki / 404",
      desc: "",
      base: BASE_PATH,
    });
    return res.status(404).send(html);
  }

  const { html: bodyHtmlRaw, meta } = renderMarkdown(node.filePath);
  const bodyHtml = applyBaseToHtml(bodyHtmlRaw);
  const pageTitle = (meta.title as string) || node.title;

  const header = renderHeader(meta as any, pageTitle);

  const crumbs = findBreadcrumbTitles(tree, urlPath);
  const where = (crumbs.length ? crumbs.join(" / ") : "Wiki");
  const desc = String((meta as any).desc ?? (meta as any).description ?? "").trim();

  const sec = findSectionForIndexPage(tree, node);
  const listing = sec ? renderSectionListing(sec) : "";

  const hideTitle = Boolean((meta as any).hideTitle ?? (meta as any).hide_title ?? (meta as any).noTitle ?? (meta as any).no_title ?? false) || ((meta as any).showTitle === false) || ((meta as any).show_title === false);

  const titleIcon = renderIconAny((meta as any).icon ?? "", "page-title-icon");
  const titleBlock = hideTitle
    ? ""
    : `<div class="page-title">${titleIcon}<h1>${escapeHtml(pageTitle)}</h1></div>`;

  const content = tpl(pageT, {
    header,
    titleBlock,
    body: bodyHtml + listing,
  });

  const html = tpl(layoutT, {
    title: escapeHtml(pageTitle),
    nav: renderNav(tree, req.path),
    content,
    where: escapeHtml(where),
    desc: escapeHtml(desc),
    base: BASE_PATH,
  });

  res.send(html);
});

const port = 3000;
app.listen(port, () => console.log(`Wiki running: http://localhost:${port}`));
