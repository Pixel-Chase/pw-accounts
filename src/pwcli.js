import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { PwaError } from './util.js';

const require = createRequire(import.meta.url);
// 用依赖里锁定版本的 playwright-cli，不走 npx：首次调用无需下载，各人机器上的浏览器版本也一致
const CLI = require.resolve('@playwright/cli/playwright-cli.js');
export const CLI_VERSION = require('@playwright/cli/package.json').version;

export function pwcli(args, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function run(args, what) {
  const r = await pwcli(args);
  if (r.code !== 0) throw new PwaError(`${what}失败：${(r.stderr || r.stdout).trim()}`);
  return r;
}

// 默认只列出当前工作区（项目）的会话；all 时列出所有项目的
export async function listSessions({ all = false } = {}) {
  const { code, stdout } = await pwcli(['list', '--json', ...(all ? ['--all'] : [])]);
  if (code !== 0) return [];
  try {
    return JSON.parse(stdout).browsers ?? [];
  } catch {
    return [];
  }
}

export async function findSession(account) {
  return (await listSessions()).find((s) => s.name === account.session) ?? null;
}

// 显式指定 chromium：playwright-cli 默认用系统 Chrome，使用者机器上不一定装了
export async function openSession(account, url, { headed = false } = {}) {
  const args = [`-s=${account.session}`, 'open', url, '--browser', 'chromium', '--profile', account.profile];
  const r = await pwcli(headed ? [...args, '--headed'] : args);
  if (r.code === 0) return r;
  const out = (r.stderr || r.stdout).trim();
  // 原始报错建议执行 playwright-cli install-browser，而这里没有全局的 playwright-cli
  if (out.includes('is not installed; expected executable')) throw new PwaError('Chromium 未安装，请执行 pwa setup');
  // 去掉 daemon 的堆栈，只保留错误行
  const errors = out.split('\n').filter((l) => l.startsWith('Error: ') && !l.includes('Daemon pid='));
  throw new PwaError(`打开会话 ${account.session} 失败：${errors.length ? errors.join('\n') : out}`);
}

export const gotoUrl = (account, url) => run([`-s=${account.session}`, 'goto', url], `跳转到 ${url} `);

export const closeSession = (account) => run([`-s=${account.session}`, 'close'], `关闭会话 ${account.session} `);

export async function currentUrl(account) {
  const { code, stdout } = await pwcli([`-s=${account.session}`, 'eval', 'location.href', '--raw']);
  if (code !== 0) return null;
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return stdout.trim() || null;
  }
}
