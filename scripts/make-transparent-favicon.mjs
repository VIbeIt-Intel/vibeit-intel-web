import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import toIco from "to-ico";

const root = process.cwd();
const src = path.join(root, "assets", "favicon-192.png");

async function clearBlack(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Near-black plate behind the mark → transparent
    if (r < 28 && g < 28 && b < 28) {
      data[i + 3] = 0;
    }
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png();
}

async function trimAndPad(img, size) {
  const trimmed = await img
    .trim({ threshold: 8 })
    .png()
    .toBuffer();

  const meta = await sharp(trimmed).metadata();
  const maxSide = Math.max(meta.width, meta.height);
  // Leave a little air around the mark so Chrome’s circle mask doesn’t clip it
  const content = Math.round(size * 0.82);
  const scale = content / maxSide;
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));
  const left = Math.floor((size - w) / 2);
  const top = Math.floor((size - h) / 2);

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp(trimmed).resize(w, h, { fit: "fill" }).png().toBuffer(),
        left,
        top,
      },
    ])
    .png()
    .toBuffer();
}

const cleared = await clearBlack(src);
const base = await trimAndPad(cleared, 512);

const out48 = await sharp(base).resize(48, 48).png().toBuffer();
const out192 = await sharp(base).resize(192, 192).png().toBuffer();
const out180 = await sharp(base).resize(180, 180).png().toBuffer();
const out32 = await sharp(base).resize(32, 32).png().toBuffer();
const out16 = await sharp(base).resize(16, 16).png().toBuffer();

fs.writeFileSync(path.join(root, "assets", "favicon-48.png"), out48);
fs.writeFileSync(path.join(root, "assets", "favicon-192.png"), out192);
fs.writeFileSync(path.join(root, "assets", "favicon.png"), out192);
fs.writeFileSync(path.join(root, "assets", "apple-touch-icon.png"), out180);

const ico = await toIco([out16, out32, out48]);
fs.writeFileSync(path.join(root, "favicon.ico"), ico);

console.log("Wrote transparent favicons:", {
  "assets/favicon-48.png": out48.length,
  "assets/favicon-192.png": out192.length,
  "assets/apple-touch-icon.png": out180.length,
  "favicon.ico": ico.length,
});
