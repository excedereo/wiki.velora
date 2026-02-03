import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { PageNode, SectionNode, FrontMatter, RouteEntry } from "./types.js";

// Robust base dir (so it works even if you run from ./dist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const CONTENT_ROOT = path.resolve(ROOT_DIR, "content");

// Path to optional wiki configuration file. This file can specify
// ordering and custom labels for top-level sections. If it doesn't
// exist or is invalid JSON, the default scanning behaviour will be
// used. Example format:
// {
//   "sections": [
//     { "dir": "Главная", "title": "Главная", "slug": "главная", "order": 0 },
//     { "dir": "Примеры", "title": "Примеры", "order": 1 }
//   ]
// }
const CONFIG_PATH = path.resolve(ROOT_DIR, "wiki.config.json");
let wikiConfig: any = {};
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const rawCfg = fs.readFileSync(CONFIG_PATH, "utf-8");
    wikiConfig = JSON.parse(rawCfg);
  }
} catch {
  // ignore parse errors; will fall back to defaults
  wikiConfig = {};
}

/**
 * Decode sequences like `#U0413` into their corresponding Unicode characters.
 * Some archive tools encode non-ASCII characters in filenames using this
 * pattern. For example, `#U0413#U043b#U0430#U0432#U043d#U0430#U044f` becomes
 * `Главная`. This helper ensures such names are normalised when building
 * slugs and titles.
 */
function decodeUnicodeEscapes(s: string): string {
  return s.replace(/#U([0-9A-Fa-f]{4})/g, (_, hex) => {
    const code = parseInt(hex, 16);
    return String.fromCharCode(code);
  });
}

function normalizeSlug(s: string) {
  // First decode any archive-style escape sequences to proper Unicode
  const decoded = decodeUnicodeEscapes(String(s));
  return decoded.trim().replace(/\s+/g, "-");
}

/**
 * Recursively update the path of a section or page after its slug has been
 * overridden. When the slug of a section changes, all descendant paths
 * should reflect the new base URL. This helper walks the tree and sets
 * `path` for sections and pages accordingly. The `parentUrlPath` argument
 * should already include the leading slash or be empty for the root.
 */
function updatePaths(node: SectionNode | PageNode, parentUrlPath: string): void {
  if (node.type === "page") {
    const slug = node.slug;
    node.path = parentUrlPath ? `${parentUrlPath}/${slug}` : `/${slug}`;
    return;
  }
  // Section
  const slug = node.slug;
  node.path = parentUrlPath ? `${parentUrlPath}/${slug}` : `/${slug}`;
  if (node.indexPage) {
    node.indexPage.slug = slug;
    node.indexPage.path = node.path;
  }
  for (const child of node.children) {
    updatePaths(child, node.path);
  }
}

function readPage(filePath: string, urlPath: string): PageNode {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  const meta = (parsed.data ?? {}) as FrontMatter;

  const baseName = path.basename(filePath, ".md");
  const slug = normalizeSlug((meta.slug as string) || baseName);
  const title = (meta.title as string) || baseName;
  const order = typeof meta.order === "number" ? meta.order : 0;

  return { type: "page", title, slug, path: urlPath, filePath, order, meta };
}

function buildSection(dirPath: string, parentUrlPath: string): SectionNode {
  const folderName = path.basename(dirPath);
  // Decode folder names that were archived with #UXXXX encoding
  const decodedName = decodeUnicodeEscapes(folderName);
  const slug = normalizeSlug(decodedName);
  const urlPath = parentUrlPath ? `${parentUrlPath}/${slug}` : `/${slug}`;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  let indexPage: PageNode | undefined;
  const children: SectionNode["children"] = [];

  for (const e of entries) {
    const full = path.join(dirPath, e.name);

    if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      const pageUrl =
        e.name.toLowerCase() === "index.md"
          ? urlPath
          : `${urlPath}/${normalizeSlug(path.basename(e.name, ".md"))}`;

      const page = readPage(full, pageUrl);
      if (e.name.toLowerCase() === "index.md") indexPage = page;
      else children.push(page);
    }

    if (e.isDirectory()) children.push(buildSection(full, urlPath));
  }

  children.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));

  // Use decoded folder name for the default title if there's no index page
  const title = indexPage?.title || decodedName;
  const order = typeof indexPage?.meta?.order === "number" ? (indexPage!.meta.order as number) : 0;

  return { type: "section", title, slug, path: urlPath, dirPath, order, indexPage, children, meta: indexPage?.meta };
}

export function buildTree(): SectionNode {
  const root: SectionNode = { type: "section", title: "root", slug: "", path: "", dirPath: CONTENT_ROOT, order: 0, children: [] };

  // List all top-level directories under CONTENT_ROOT
  const entries = fs
    .readdirSync(CONTENT_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const top: SectionNode[] = [];

  // If a configuration file defines an ordered list of sections, build them first
  const cfgSections = Array.isArray(wikiConfig.sections) ? wikiConfig.sections : [];
  for (const cfg of cfgSections) {
    if (!cfg || typeof cfg.dir !== "string") continue;
    const dirName: string = cfg.dir;
    if (!entries.includes(dirName)) continue;

    const sec = buildSection(path.join(CONTENT_ROOT, dirName), "");

    // Override title if provided
    if (cfg.title) sec.title = String(cfg.title);
    // Override order if provided
    if (typeof cfg.order === "number") sec.order = cfg.order;
    // Override slug and update the URL structure when provided
    if (cfg.slug) {
      const newSlug = normalizeSlug(cfg.slug);
      sec.slug = newSlug;
      // updatePaths will set the correct path on the section and all descendants
      updatePaths(sec, "");
    }

    top.push(sec);
  }

  // Build sections for any directories not explicitly mentioned in the config
  const usedDirs = new Set(cfgSections.map((s: any) => s && s.dir));
  for (const dir of entries) {
    if (!usedDirs.has(dir)) {
      top.push(buildSection(path.join(CONTENT_ROOT, dir), ""));
    }
  }

  // Sort sections by order and then by title
  top.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.title.localeCompare(b.title);
  });

  root.children = top;
  return root;
}

export function buildRoutes(tree: SectionNode): RouteEntry[] {
  const out: RouteEntry[] = [];
  function walk(node: SectionNode | PageNode) {
    if (node.type === "page") { out.push({ urlPath: node.path, node }); return; }
    if (node.indexPage) out.push({ urlPath: node.indexPage.path, node: node.indexPage });
    node.children.forEach(walk);
  }
  tree.children.forEach(walk);
  return out;
}
