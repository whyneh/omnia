/**
 * Single source of truth for the app version: package.json.
 * Edit the version there, then run `pnpm version:sync` to propagate it to
 * Cargo.toml, tauri.conf.json and Cargo.lock before committing / tagging.
 */
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  throw new Error(`package.json 中不是合法的 semver 版本: ${version}`);
}

const cargoToml = "src-tauri/Cargo.toml";
let toml = readFileSync(cargoToml, "utf8");
if (!/^version = "[^"]+"/m.test(toml)) throw new Error("Cargo.toml 缺少 package.version");
writeFileSync(cargoToml, toml.replace(/^version = "[^"]+"/m, `version = "${version}"`));

const tauriConf = "src-tauri/tauri.conf.json";
const conf = JSON.parse(readFileSync(tauriConf, "utf8"));
conf.version = version;
writeFileSync(tauriConf, `${JSON.stringify(conf, null, 2)}\n`);

const cargoLock = "src-tauri/Cargo.lock";
const lines = readFileSync(cargoLock, "utf8").split(/\r?\n/);
const nameLine = lines.findIndex((line) => line.trim() === 'name = "omnia"');
if (nameLine < 0) throw new Error("Cargo.lock 中找不到 omnia 包");
let replaced = false;
for (let i = nameLine + 1; i < Math.min(nameLine + 8, lines.length); i += 1) {
  if (/^version = "/.test(lines[i])) {
    lines[i] = `version = "${version}"`;
    replaced = true;
    break;
  }
}
if (!replaced) throw new Error("Cargo.lock 中找不到 omnia 的 version 行");
writeFileSync(cargoLock, lines.join("\n"));

console.log(`版本已同步为 ${version}（Cargo.toml / tauri.conf.json / Cargo.lock）`);
