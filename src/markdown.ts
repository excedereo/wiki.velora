import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";
import { FrontMatter } from "./types.js";

// Robust base dir (so download widget can resolve file sizes even if
// the process is started from ./dist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

marked.setOptions({ async: false });

function escAttr(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format a byte count as a human readable file size.  Uses binary
 * prefixes (KiB, MiB, GiB) with one decimal place.  Falls back to
 * bytes if the value is less than 1 KiB.
 */
function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let idx = 0;
  let num = bytes;
  while (num >= 1024 && idx < units.length - 1) {
    num /= 1024;
    idx++;
  }
  return `${num.toFixed(num < 10 && idx > 0 ? 1 : 0)} ${units[idx]}`;
}

function safeCssSize(input: string): string {
  const v = (input || "").trim();
  if (!v) return "";
  // Pure number -> px
  if (/^\d+(?:\.\d+)?$/.test(v)) return `${v}px`;
  // Allow a small whitelist of size units
  if (/^\d+(?:\.\d+)?(px|%|vw|vh|rem|em)$/.test(v)) return v;
  return "";
}

function safeCssColor(input: string): string {
  const v = (input || "").trim();
  if (!v) return "";
  // Hex colors: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
  // rgb()/rgba() with digits, dots, spaces, commas, %
  if (/^rgba?\(\s*[0-9.,%\s]+\)$/.test(v)) return v;
  // hsl()/hsla() with digits, dots, spaces, commas, %
  if (/^hsla?\(\s*[0-9.,%\s]+\)$/.test(v)) return v;
  // Named colors (limited)
  if (/^[a-zA-Z]+$/.test(v)) return v;
  // CSS variables
  if (/^var\(--[a-zA-Z0-9_-]+\)$/.test(v)) return v;
  return "";
}

function resolveIconSrc(nameOrPath: string): string {
  const v = (nameOrPath || "").trim();
  if (!v) return "";

  // If user provided an explicit path (starts with /) or a filename
  // with an extension, trust it.
  if (v.startsWith("/") || /\.[a-z0-9]+$/i.test(v)) return v;

  // Otherwise treat it as a named icon in /public/assets/icons.
  const svgRel = `/assets/icons/${v}.svg`;
  const pngRel = `/assets/icons/${v}.png`;
  // When joining, remove the leading slash so path.join doesn't treat it as absolute.
  const svgAbs = path.join(ROOT_DIR, "public", svgRel.slice(1));
  const pngAbs = path.join(ROOT_DIR, "public", pngRel.slice(1));
  try {
    if (fs.existsSync(svgAbs)) return svgRel;
    if (fs.existsSync(pngAbs)) return pngRel;
  } catch {
    // ignore
  }
  return pngRel;
}

/**
 * Gallery widget in markdown:
 *
 * ```gallery
 * align: center     # left | center | right
 * width: 720        # optional max width in px
 * /assets/gallery/one.png | Caption
 * /assets/gallery/anim.gif | Caption
 * ```
 */
marked.use({
  extensions: [
    /**
     * Gradient text macro.
     *
     * Usage:
     *   <gradient:#e61f4b:#a51635>Текст</gradient>
     *
     * Both colors are optional to validate; if invalid, falls back to accent vars.
     */
    {
      name: "gradientInline",
      level: "inline",
      start(src: string) {
        const i = src.indexOf("<gradient:");
        return i >= 0 ? i : undefined;
      },
      tokenizer(src: string) {
        const re = /^<gradient:([^:>]+):([^>]+)>([\s\S]*?)<\/gradient>/;
        const m = re.exec(src);
        if (!m) return;
        const raw = m[0];
        const c1Raw = (m[1] || "").trim();
        const c2Raw = (m[2] || "").trim();
        const inner = m[3] ?? "";
        const tokens = this.lexer.inlineTokens(inner);
        return { type: "gradientInline", raw, c1Raw, c2Raw, tokens } as any;
      },
      renderer(token: any) {
        const c1 = safeCssColor(token.c1Raw) || "var(--accent)";
        const c2 = safeCssColor(token.c2Raw) || "var(--accent2)";
        const inner = this.parser.parseInline(token.tokens || []);
        return `<span class="gradient-text" style="${escAttr(`--g1:${c1};--g2:${c2}`)}">${inner}</span>`;
      },
    },

    /**
     * Internal link macro (helps ссылаться на другие разделы/страницы).
     *
     * Usage:
     *   [[link:/guide/install|Установка]]
     *   [[page:guide/install|Установка]]   // same as link
     *   [[cat:guide|Раздел]]              // link to section index
     *
     * If no label is provided, the path is used as label.
     */
    {
      name: "wikiLink",
      level: "inline",
      start(src: string) {
        const i = src.indexOf("[[");
        return i >= 0 ? i : undefined;
      },
      tokenizer(src: string) {
        const re = /^\[\[(link|page|cat):([^\]\|]+?)(?:\|([^\]]+))?\]\]/;
        const m = re.exec(src);
        if (!m) return;
        const raw = m[0];
        const kind = (m[1] || "link").toLowerCase();
        const targetRaw = (m[2] || "").trim();
        const labelRaw = (m[3] || "").trim();
        return { type: "wikiLink", raw, kind, targetRaw, labelRaw } as any;
      },
      renderer(token: any) {
        const kind = token.kind as string;
        let target = String(token.targetRaw || "").trim();
        const label = String(token.labelRaw || "").trim();
        if (!target) return "";
        if (!target.startsWith("/")) target = "/" + target;
        // cat: treat as section index
        if (kind === "cat" && !target.endsWith("/")) {
          target = target.replace(/\/$/, "");
        }
        const text = label || target.replace(/^\//, "");
        return `<a class="wiki-link" href="${escAttr(target)}">${escAttr(text)}</a>`;
      },
    },

/**
 * Inline color macro.
 *
 * Usage:
 *   <#3e9eff>Текст</#3e9eff>
 *   <#3e9eff>Текст<.#3e9eff>
 */
{
  name: "colorInline",
  level: "inline",
  start(src: string) {
    const i = src.indexOf("<#");
    return i >= 0 ? i : undefined;
  },
  tokenizer(src: string) {
    const re = /^<(#[0-9a-f]{3,8})>([\s\S]*?)(?:<\/\1>|<\.\1>)/i;
    const m = re.exec(src);
    if (!m) return;
    const raw = m[0];
    const colorRaw = (m[1] || "").trim();
    const inner = m[2] ?? "";
    const tokens = this.lexer.inlineTokens(inner);
    return { type: "colorInline", raw, colorRaw, tokens } as any;
  },
  renderer(token: any) {
    const c = safeCssColor(token.colorRaw) || "var(--text)";
    const inner = this.parser.parseInline(token.tokens || []);
    return `<span class="color-text" style="${escAttr(`color:${c}`)}">${inner}</span>`;
  },
},
    /**
     * Single image widget with alignment and sizing.
     *
     * ```image
     * src: /assets/pic.png
     * alt: Описание
     * align: left   # left | center | right
     * width: 360    # number -> px, or css size like 50%
     * height: 220   # optional
     * fit: cover    # cover | contain (only matters if height is set)
     * caption: Подпись (optional)
     * link: /somewhere (optional)
     * ```
     */
    {
      name: "imageFence",
      level: "block",
      start(src: string) {
        const m = src.match(/```image/);
        return m ? (m.index ?? undefined) : undefined;
      },
      tokenizer(src: string) {
        const re = /^```image\s*\n([\s\S]*?)\n```/;
        const m = re.exec(src);
        if (!m) return;
        const raw = m[0];
        const body = m[1];

        let srcPath = "";
        let alt = "";
        let caption = "";
        let link = "";
        let align: "left" | "center" | "right" = "center";
        let width = "";
        let height = "";
        let fit: "cover" | "contain" = "contain";

        for (const lineRaw of body.split("\n")) {
          const line = lineRaw.trim();
          if (!line || line.startsWith("#")) continue;
          const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
          if (!kv) continue;
          const key = kv[1].toLowerCase();
          const val = kv[2].trim();
          if (key === "src" || key === "file" || key === "path") srcPath = val;
          else if (key === "alt") alt = val;
          else if (key === "caption") caption = val;
          else if (key === "link" || key === "href") link = val;
          else if (key === "align" && (val === "left" || val === "center" || val === "right")) align = val;
          else if (key === "width") width = val;
          else if (key === "height") height = val;
          else if (key === "fit" && (val === "cover" || val === "contain")) fit = val;
        }

        return {
          type: "imageFence",
          raw,
          srcPath,
          alt,
          caption,
          link,
          align,
          width,
          height,
          fit,
        } as any;
      },
      renderer(token: any) {
        const srcPath = String(token.srcPath || "").trim();
        if (!srcPath) return "";
        const alt = String(token.alt || "").trim();
        const caption = String(token.caption || "").trim();
        const link = String(token.link || "").trim();
        const align = (token.align === "left" || token.align === "right" || token.align === "center") ? token.align : "center";

        const w = safeCssSize(String(token.width || ""));
        const h = safeCssSize(String(token.height || ""));
        const fit = (token.fit === "cover" || token.fit === "contain") ? token.fit : "contain";

        const styleParts: string[] = [];
        if (w) styleParts.push(`--wimage-w:${w}`);
        if (h) styleParts.push(`--wimage-h:${h}`);
        if (h) styleParts.push(`--wimage-fit:${fit}`);
        const styleAttr = styleParts.length ? ` style="${escAttr(styleParts.join(";"))}"` : "";

        const imgTag = `<img src="${escAttr(srcPath)}" alt="${escAttr(alt)}" loading="eager" decoding="async" />`;
        const inner = link ? `<a class="wimage-link" href="${escAttr(link)}">${imgTag}</a>` : imgTag;
        const capHtml = caption ? `<figcaption class="wimage-cap">${escAttr(caption)}</figcaption>` : "";
        return `<figure class="wimage align-${escAttr(align)}"${styleAttr}><div class="wimage-media">${inner}</div>${capHtml}</figure>`;
      },
    },
    {
      name: "galleryFence",
      level: "block",
      start(src: string) {
        const m = src.match(/```gallery/);
        return m ? (m.index ?? undefined) : undefined;
      },
      tokenizer(src: string) {
        const re = /^```gallery\s*\n([\s\S]*?)\n```/;
        const m = re.exec(src);
        if (!m) return;

        const raw = m[0];
        const body = m[1];

        let align: "left" | "center" | "right" = "center";
        let width: number | null = null;
        const items: Array<{ src: string; caption?: string }> = [];

        for (const lineRaw of body.split("\n")) {
          const line = lineRaw.trim();
          if (!line || line.startsWith("#")) continue;

          const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
          if (kv) {
            const key = kv[1].toLowerCase();
            const val = kv[2].trim();
            if (key === "align" && (val === "left" || val === "center" || val === "right")) align = val;
            if (key === "width") {
              const n = Number(val);
              width = Number.isFinite(n) && n > 0 ? n : null;
            }
            continue;
          }

          const [srcPart, capPart] = line.split("|").map(s => s.trim());
          if (!srcPart) continue;
          items.push(capPart ? { src: srcPart, caption: capPart } : { src: srcPart });
        }

        return {
          type: "galleryFence",
          raw,
          align,
          width,
          items,
        } as any;
      },
      renderer(token: any) {
        const payload = encodeURIComponent(JSON.stringify(token.items ?? []));
        const w = token.width ? String(token.width) : "";
        return `<div class="wgallery" data-align="${escAttr(token.align || "center")}" data-width="${escAttr(w)}" data-items="${escAttr(payload)}"></div>`;
      },
    },
    /*
     * Download card widget.  Allows authors to insert a fenced block
     * that generates a styled download card.  The block accepts
     * key/value pairs such as `file`, `label` and `desc`.  The file
     * size is determined on the server by reading the file from the
     * `public` directory (ignoring a leading slash).  If the file
     * cannot be found then the size is omitted.
     *
     * Example usage in Markdown:
     *
     * ```download
     * file: /downloads/archive.zip
     * label: Скачать архив
     * desc: Содержит PDF и изображения
     * ```
     */
    {
      name: "downloadFence",
      level: "block",
      start(src: string) {
        const m = src.match(/```download/);
        return m ? (m.index ?? undefined) : undefined;
      },
      tokenizer(src: string) {
        const re = /^```download\s*\n([\s\S]*?)\n```/;
        const m = re.exec(src);
        if (!m) return;
        const raw = m[0];
        const body = m[1];
        let file = "";
        let label = "";
        let desc = "";
        for (const lineRaw of body.split("\n")) {
          const line = lineRaw.trim();
          if (!line || line.startsWith("#")) continue;
          const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
          if (kv) {
            const key = kv[1].toLowerCase();
            const val = kv[2].trim();
            if (key === "file") file = val;
            if (key === "label") label = val;
            if (key === "desc" || key === "description") desc = val;
            continue;
          }
        }
        return {
          type: "downloadFence",
          raw,
          file,
          label,
          desc,
        } as any;
      },
      renderer(token: any) {
        let filePath: string = token.file || "";
        let sizeStr = "";
        if (filePath) {
          try {
            // Remove leading slash so that join doesn’t interpret it as an
            // absolute path.  Files are served from the `public` folder.
            const relative = filePath.startsWith("/") ? filePath.slice(1) : filePath;
            const fullPath = path.join(ROOT_DIR, "public", relative);
            const stat = fs.statSync(fullPath);
            sizeStr = humanFileSize(stat.size);
          } catch {
            sizeStr = "";
          }
        }
        const label = token.label || (filePath ? path.basename(filePath) : "");
        const desc = token.desc || "";
        const sizeHtml = sizeStr ? `<div class="download-size">${escAttr(sizeStr)}</div>` : "";
        const descHtml = desc ? `<div class="download-desc">${escAttr(desc)}</div>` : "";
        return `<div class="wdownload"><a class="download-card" href="${escAttr(filePath)}" download><div class="download-icon"><img src="/assets/download.svg" alt="" /></div><div class="download-info"><div class="download-label">${escAttr(label)}</div>${sizeHtml}${descHtml}</div></a></div>`;
      },
    },
    /*
     * Callout block widget.  Provides stylised boxes for notes,
     * warnings and tips.  A callout block uses key/value pairs
     * similar to YAML.  Supported keys: `type` (note|warning|tip),
     * `title` for a custom heading, and any remaining text becomes
     * the body of the callout.  Body text is parsed with Markdown
     * allowing rich formatting inside callouts.
     *
     * Example usage in Markdown:
     *
     * ```callout
     * type: warning
     * title: Осторожно!
     * Нельзя запускать скрипт от root.
     * ```
     */
    {
      name: "calloutFence",
      level: "block",
      start(src: string) {
        const m = src.match(/```callout/);
        return m ? (m.index ?? undefined) : undefined;
      },
      tokenizer(src: string) {
        const re = /^```callout\s*\n([\s\S]*?)\n```/;
        const m = re.exec(src);
        if (!m) return;
        const raw = m[0];
        const body = m[1];
        let calloutType: "note" | "warning" | "tip" | "error" = "note";
        let title = "";
        let icon = "";
        const contentLines: string[] = [];
        for (const lineRaw of body.split("\n")) {
          // Preserve original spacing for the body
          const line = lineRaw;
          const trimmed = line.trim();
          if (!trimmed) {
            contentLines.push("\n");
            continue;
          }
          const kv = trimmed.match(/^(\w+)\s*:\s*(.+)$/);
          if (kv) {
            const key = kv[1].toLowerCase();
            const val = kv[2].trim();
            if (key === "type" && (val === "note" || val === "warning" || val === "tip" || val === "error")) calloutType = val;
            else if (key === "title") title = val;
            else if (key === "icon") icon = val;
            else {
              contentLines.push(line);
            }
          } else {
            contentLines.push(line);
          }
        }
        return {
          type: "calloutFence",
          raw,
          calloutType,
          title,
          icon,
          body: contentLines.join("\n").trim(),
        } as any;
      },
      renderer(token: any) {
        const type = token.calloutType || "note";
        const defaultTitles: Record<string, string> = {
          note: "Примечание",
          warning: "Предупреждение",
          tip: "Совет",
        };
        const title = token.title || defaultTitles[type] || "";
        // Parse the body using marked so that Markdown syntax is supported inside callouts
        let bodyHtml = "";
        if (token.body) {
          // Convert the parsed Markdown into a string.  marked.parse
          // may return a string or a Promise<string>, but our
          // configuration uses synchronous parsing, so String() is safe.
          bodyHtml = String(marked.parse(token.body));
        }
        const iconSrcRaw = (token.icon || "").trim();
        // Allow shorthand icons like "idea" -> /assets/icons/idea.(svg|png)
        const iconSrc = iconSrcRaw ? resolveIconSrc(iconSrcRaw) : "";
        const iconHtml = iconSrc ? `<div class="callout-icon"><img src="${escAttr(iconSrc)}" alt="" loading="eager" decoding="async" /></div>` : "";
        const hasIconClass = iconSrc ? " has-icon" : "";
        return `<div class="callout ${escAttr(type)}${hasIconClass}"><div class="callout-inner">${iconHtml}<div class="callout-content"><div class="callout-title">${escAttr(title)}</div><div class="callout-body">${bodyHtml}</div></div></div></div>`;
      },
    },

    /**
     * Inline icon / image macro.
     *
     * Usage in Markdown text:
     *   Текст [[icon:idea]] текст
     *   Текст [[icon:idea|h=18]] текст
     *   Текст [[img:/assets/pics/logo.png|h=20|alt=Лого]] текст
     */
    {
      name: "inlineAsset",
      level: "inline",
      start(src: string) {
        const i = src.indexOf("[[");
        return i >= 0 ? i : undefined;
      },
      tokenizer(src: string) {
        const re = /^\[\[(icon|img):([^\]\|]+?)(?:\|([^\]]+))?\]\]/;
        const m = re.exec(src);
        if (!m) return;
        const raw = m[0];
        const kind = m[1] as "icon" | "img";
        const ref = (m[2] || "").trim();
        const optsRaw = (m[3] || "").trim();
        const opts: Record<string, string> = {};
        if (optsRaw) {
          for (const partRaw of optsRaw.split("|")) {
            const part = partRaw.trim();
            if (!part) continue;
            const eq = part.indexOf("=");
            if (eq === -1) continue;
            const k = part.slice(0, eq).trim().toLowerCase();
            const v = part.slice(eq + 1).trim();
            if (!k) continue;
            opts[k] = v;
          }
        }
        return { type: "inlineAsset", raw, kind, ref, opts } as any;
      },
      renderer(token: any) {
        const kind = token.kind as "icon" | "img";
        const ref = (token.ref || "").trim();
        const opts = (token.opts || {}) as Record<string, string>;

        // Source resolution:
        // - icon: NAME or path
        // - img: path, or NAME (treated as icon name)
        const src = kind === "icon" ? resolveIconSrc(ref) : resolveIconSrc(ref);
        const alt = opts.alt || "";
        const height = safeCssSize(opts.h || opts.height || opts.size || "1em") || "1em";
        const width = safeCssSize(opts.w || opts.width || "");
        const alignRaw = (opts.a || opts.align || "middle").toLowerCase();
        const va = alignRaw === "top" || alignRaw === "bottom" || alignRaw === "baseline" ? alignRaw : "middle";

        const styleParts: string[] = [`height:${height}`, `vertical-align:${va}`];
        if (width) styleParts.push(`width:${width}`);

        const imgHtml = `<img class="inline-media" src="${escAttr(src)}" alt="${escAttr(alt)}" style="${escAttr(styleParts.join(";"))}" loading="eager" decoding="async" />`;
        const link = opts.link || opts.href || "";
        if (link) return `<a class="inline-media-link" href="${escAttr(link)}">${imgHtml}</a>`;
        return imgHtml;
      },
    },
  ],
});

export function renderMarkdown(filePath: string): { html: string; meta: FrontMatter } {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  const meta = (parsed.data ?? {}) as FrontMatter;
  const html: string = String(marked.parse(parsed.content));
  return { html, meta };
}
