import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

function normalizeBase(b: string): string {
    b = String(b || "").trim();
    if (!b) return "/";
    if (!b.startsWith("/")) b = "/" + b;
    if (!b.endsWith("/")) b = b + "/";
    return b;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const SITE_DIR = path.resolve(ROOT_DIR, "site");

const BASE_PATH = normalizeBase(process.env.BASE_PATH || "/wiki.velora");
const MOUNT = BASE_PATH === "/" ? "/" : BASE_PATH.slice(0, -1);

const app = express();
app.use(MOUNT, express.static(SITE_DIR, { extensions: ["html"] }));
if (MOUNT !== "/") app.get("/", (_req, res) => res.redirect(BASE_PATH));

const port = Number(process.env.PORT || 4173);
app.listen(port, () => {
    console.log(`Preview: http://localhost:${port}${BASE_PATH}`);
});