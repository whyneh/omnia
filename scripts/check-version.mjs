/**
 * 校验 Release 标签与 package.json 版本是否一致。
 *
 * 版本号的唯一来源是 package.json，打标签前应已运行 `pnpm version:sync`
 * 把它同步到 Cargo.toml / tauri.conf.json / Cargo.lock。
 *
 * 用法：
 *   node scripts/check-version.mjs v1.0.0
 *   node scripts/check-version.mjs            # 自动读取 git 当前标签
 *
 * 不一致时以退出码 1 结束，CI 中会中断发布。
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;

let tag = process.argv[2];
if (!tag) {
  try {
    tag = execSync("git describe --tags --exact-match", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    console.error("未传入标签，且当前提交不在任何标签上。");
    console.error("用法: node scripts/check-version.mjs v1.0.0");
    process.exit(1);
  }
}

const expected = `v${version}`;
console.log(`标签: ${tag}　package.json: ${version}`);

if (tag !== expected) {
  console.error(`\n标签与版本不一致：期望 ${expected}，实际 ${tag}。`);
  console.error("请先修改 package.json 的 version，运行 pnpm version:sync，");
  console.error("提交后再打标签，否则安装包内的版本号会与 Release 标题不符。");
  process.exit(1);
}

console.log("版本校验通过。");
