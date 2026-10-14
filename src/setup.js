import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION, pwcli } from './pwcli.js';
import { PwaError } from './util.js';

const SKILL_SRC = fileURLToPath(new URL('../skill/SKILL.md', import.meta.url));
const IGNORE_LINES = ['.playwright/', '.playwright-cli/'];

async function chromiumPath() {
  const { stdout } = await pwcli(['install-browser', 'chromium', '--no-shell', '--dry-run']);
  return stdout.match(/\(playwright chromium v\d+\)\s*\n\s*Install location:\s*(.+)/)?.[1].trim() ?? null;
}

async function installBrowser() {
  const { code } = await pwcli(['install-browser', 'chromium', '--no-shell'], { inherit: true });
  if (code !== 0) throw new PwaError('Chromium 安装失败');
}

// ~/.claude 与 ~/.codex 存在哪个就装到哪个；~/.codex/skills 常是指向 ~/.claude/skills 的软链，按真实路径去重
function skillTargets() {
  const seen = new Set();
  const targets = [];
  for (const base of ['.claude', '.codex']) {
    const root = path.join(os.homedir(), base);
    if (!fs.existsSync(root)) continue;
    const skills = path.join(root, 'skills');
    const real = fs.existsSync(skills) ? fs.realpathSync(skills) : skills;
    if (seen.has(real)) continue;
    seen.add(real);
    targets.push(path.join(skills, 'pw-accounts', 'SKILL.md'));
  }
  return targets;
}

const skillUpToDate = (target) =>
  fs.existsSync(target) && fs.readFileSync(target, 'utf8') === fs.readFileSync(SKILL_SRC, 'utf8');

function installSkill() {
  const targets = skillTargets();
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(SKILL_SRC, target);
  }
  return targets;
}

// 返回全局 gitignore 文件及缺少的条目；没装 git 时返回 null
function ignoreStatus() {
  const r = spawnSync('git', ['config', '--global', 'core.excludesFile'], { encoding: 'utf8' });
  if (r.error) return null;
  const configured = r.stdout.trim().replace(/^~(?=$|\/)/, os.homedir());
  const file =
    configured || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'git', 'ignore');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  return { file, missing: IGNORE_LINES.filter((l) => !lines.includes(l)) };
}

function setupGitignore() {
  const status = ignoreStatus();
  if (!status?.missing.length) return status;
  fs.mkdirSync(path.dirname(status.file), { recursive: true });
  const prev = fs.existsSync(status.file) ? fs.readFileSync(status.file, 'utf8') : '';
  const sep = prev && !prev.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(status.file, `${sep}${status.missing.join('\n')}\n`);
  return status;
}

// 刚安装或升级后还没执行 pwa setup 的迹象：缺 Chromium，或已装的 agent skill 不是当前版本
export async function pendingSetup() {
  const pending = [];
  const browser = await chromiumPath();
  if (!(browser && fs.existsSync(browser))) pending.push('Chromium 未安装');
  const targets = skillTargets();
  if (targets.length && !targets.every(skillUpToDate)) pending.push('agent skill 未安装或不是当前版本');
  return pending;
}

export async function setup(log = console.log) {
  const browser = await chromiumPath();
  if (browser && fs.existsSync(browser)) {
    log(`Chromium 已安装：${browser}`);
  } else {
    log('下载 Chromium（约 120 MB）…');
    await installBrowser();
  }

  const targets = installSkill();
  if (targets.length) for (const t of targets) log(`已安装 agent skill：${t}`);
  else log('未发现 ~/.claude 或 ~/.codex，跳过 agent skill 安装');

  const ignore = setupGitignore();
  if (!ignore) log('未找到 git，跳过全局 gitignore');
  else if (ignore.missing.length) log(`已写入全局 gitignore ${ignore.file}：${ignore.missing.join(' ')}`);
  else log(`全局 gitignore 已包含 ${IGNORE_LINES.join(' ')}`);
}

// 每项 { name, ok, detail, fix? }
export async function doctor() {
  const checks = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  checks.push({
    name: 'Node.js',
    ok: major > 20 || (major === 20 && minor >= 12),
    detail: process.version,
    fix: '需要 Node.js 20.12 及以上',
  });

  const browser = await chromiumPath();
  checks.push({
    name: 'Chromium',
    ok: Boolean(browser && fs.existsSync(browser)),
    detail: `@playwright/cli ${CLI_VERSION}${browser ? `，${browser}` : ''}`,
    fix: '执行 pwa setup',
  });

  if (process.platform === 'linux') {
    checks.push({
      name: '图形界面',
      ok: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
      detail: `DISPLAY=${process.env.DISPLAY ?? ''}`,
      fix: 'pwa login 需要弹出浏览器窗口。WSL 下确认 WSLg 可用，异常时在 Windows 侧执行 wsl --shutdown 后重开终端',
    });
  }

  const targets = skillTargets();
  checks.push({
    name: 'agent skill',
    ok: targets.length > 0 && targets.every(skillUpToDate),
    detail: targets.join('，') || '未发现 ~/.claude 或 ~/.codex',
    fix: '执行 pwa setup',
  });

  const ignore = ignoreStatus();
  checks.push({
    name: '全局 gitignore',
    ok: Boolean(ignore && !ignore.missing.length),
    detail: ignore ? ignore.file : '未找到 git',
    fix: '执行 pwa setup',
  });

  return checks;
}
