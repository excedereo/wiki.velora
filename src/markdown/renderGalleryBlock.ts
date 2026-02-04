// Example parser for ```gallery fenced block lines:
//   src | caption | width | align
// Notes:
// - Put this into YOUR markdown renderer where fenced blocks are handled.
// - Return HTML with <div class="wgallery" data-items="..."> so gallery.js can mount it.

export type WGalleryItem = { src: string; caption?: string; width?: string; align?: "left"|"center"|"right"|string };

export function renderGalleryBlock(raw: string, defaults?: { width?: string; align?: string }) {
  const lines = raw.split(/\r?\n/);

  let defaultWidth = defaults?.width || "";
  let defaultAlign = (defaults?.align || "").toLowerCase();

  const items: WGalleryItem[] = [];

  for (const line0 of lines) {
    const line = line0.trim();
    if (!line) continue;

    // optional defaults inside the block:
    const mAlign = line.match(/^align\s*:\s*(left|center|right)\s*$/i);
    if (mAlign) { defaultAlign = mAlign[1].toLowerCase(); continue; }

    const mWidth = line.match(/^width\s*:\s*(.+)\s*$/i);
    if (mWidth) { defaultWidth = mWidth[1].trim(); continue; }

    const parts = line.split("|").map(s => s.trim());
    const src = parts[0];
    if (!src) continue;

    items.push({
      src,
      caption: parts[1] || "",
      width: parts[2] || "",
      align: parts[3] || "",
    });
  }

  const enc = encodeURIComponent(JSON.stringify(items));
  const a = defaultAlign ? ` data-align="${defaultAlign}"` : "";
  const w = defaultWidth ? ` data-width="${defaultWidth}"` : "";
  return `<div class="wgallery"${a}${w} data-items="${enc}"></div>`;
}
