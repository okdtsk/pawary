// One-off icon rasterizer: app/public/icons/paw.svg → committed PNGs.
// Run with: npm run icons   (requires the root `sharp` devDependency)
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ICONS = path.join(ROOT, "..", "app", "public", "icons");
const SVG = path.join(ICONS, "paw.svg");
const CLAY = "#db7434";

async function main() {
  await mkdir(ICONS, { recursive: true });

  // Standard icons keep the transparent rounded corners.
  await sharp(SVG).resize(192, 192).png().toFile(path.join(ICONS, "icon-192.png"));
  await sharp(SVG).resize(512, 512).png().toFile(path.join(ICONS, "icon-512.png"));

  // Maskable + apple-touch are flattened onto full-bleed clay so OS masks
  // and iOS's forced-opaque corners never reveal gaps.
  await sharp(SVG)
    .resize(512, 512)
    .flatten({ background: CLAY })
    .png()
    .toFile(path.join(ICONS, "icon-512-maskable.png"));
  await sharp(SVG)
    .resize(180, 180)
    .flatten({ background: CLAY })
    .png()
    .toFile(path.join(ICONS, "apple-touch-icon.png"));

  console.log("icons written to", ICONS);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
