#!/usr/bin/env node
/* global Buffer, console, process */
/**
 * Regenerate Homepress lettermark icons (white H on #0a0a0a).
 * Requires sharp (available via Next.js / pnpm store).
 *
 * Usage (from repo root):
 *   node scripts/generate-homepress-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadSharp() {
  try {
    return require("sharp");
  } catch {
    // pnpm: sharp lives under next's dependency tree
    const candidates = fs
      .readdirSync(path.join(root, "node_modules/.pnpm"))
      .filter((d) => d.startsWith("sharp@"))
      .map((d) => path.join(root, "node_modules/.pnpm", d, "node_modules/sharp"));
    for (const c of candidates) {
      try {
        return require(c);
      } catch {
        /* try next */
      }
    }
    throw new Error("sharp not found — run pnpm install in the web workspace first");
  }
}

const sharp = loadSharp();
const BG = "#0a0a0a";
const FG = "#ffffff";
const ANY_PAD = 0.14;
const MASKABLE_PAD = 0.22;

function markSvg(size, padFrac) {
  const content = size * (1 - 2 * padFrac);
  const left = size * padFrac;
  const top = size * padFrac;
  const barW = content * 0.18;
  const crossH = content * 0.16;
  const crossY = top + (content - crossH) / 2;
  const rightBarX = left + content - barW;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <rect x="${left}" y="${top}" width="${barW}" height="${content}" fill="${FG}"/>
  <rect x="${rightBarX}" y="${top}" width="${barW}" height="${content}" fill="${FG}"/>
  <rect x="${left}" y="${crossY}" width="${content}" height="${crossH}" fill="${FG}"/>
</svg>`;
}

async function writePng(outPath, size, padFrac) {
  const svg = Buffer.from(markSvg(size, padFrac));
  await sharp(svg).png().toFile(outPath);
  console.log("wrote", path.relative(root, outPath), `(${size}×${size}, pad ${padFrac})`);
}

function writeIco(outPath, frames) {
  const count = frames.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntrySize = 16;
  let offset = 6 + count * dirEntrySize;
  const entries = [];
  const payloads = [];

  for (const { size, png } of frames) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    payloads.push(png);
    offset += png.length;
  }

  fs.writeFileSync(outPath, Buffer.concat([header, ...entries, ...payloads]));
  console.log("wrote", path.relative(root, outPath));
}

async function main() {
  const iconsDir = path.join(root, "web/public/icons");
  const appDir = path.join(root, "web/app");
  fs.mkdirSync(iconsDir, { recursive: true });

  fs.writeFileSync(path.join(iconsDir, "homepress-mark.svg"), markSvg(512, ANY_PAD));
  console.log("wrote", path.relative(root, path.join(iconsDir, "homepress-mark.svg")));

  await writePng(path.join(iconsDir, "icon-192.png"), 192, ANY_PAD);
  await writePng(path.join(iconsDir, "icon-512.png"), 512, ANY_PAD);
  await writePng(path.join(iconsDir, "icon-512-maskable.png"), 512, MASKABLE_PAD);

  await writePng(path.join(appDir, "icon.png"), 32, ANY_PAD);
  await writePng(path.join(appDir, "apple-icon.png"), 180, ANY_PAD);

  const png16 = await sharp(Buffer.from(markSvg(16, ANY_PAD))).png().toBuffer();
  const png32 = await sharp(Buffer.from(markSvg(32, ANY_PAD))).png().toBuffer();
  writeIco(path.join(appDir, "favicon.ico"), [
    { size: 16, png: png16 },
    { size: 32, png: png32 },
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
