/**
 * Copies the hashed build output to stable filenames so preview.html (the
 * IPC-stubbed visual harness) keeps working after every rebuild.
 * Usage: npm run preview
 */
import { readFileSync, copyFileSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const js = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1];
const css = html.match(/href="\/assets\/([^"]+\.css)"/)?.[1];
if (!js || !css) throw new Error("could not read asset names from dist/index.html");

copyFileSync(`dist/assets/${js}`, "dist/assets/app.js");
copyFileSync(`dist/assets/${css}`, "dist/assets/app.css");
console.log(`preview.html ready  (${js}, ${css})`);
