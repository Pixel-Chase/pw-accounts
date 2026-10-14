import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CONFIG_DIR,
  CONFIG_FILE,
  boundProjects,
  ensureProfileDir,
  isLoginPage,
  resolveTarget,
  saveProject,
  validateAccountName,
  validatePattern,
  validateUrl,
} from './config.js';
import { closeSession, currentUrl, findSession, gotoUrl, listSessions, openSession } from './pwcli.js';
import { PWA_HOME, PwaError, readJson } from './util.js';

export async function accountStatus(project) {
  const sessions = await listSessions();
  return Object.entries(project.cfg.accounts).map(([name, entry]) => {
    const session = sessions.find((s) => s.name === name);
    return {
      name,
      url: entry.url ?? '',
      desc: entry.desc ?? '',
      hasProfile: fs.existsSync(path.join(project.home, name)),
      session: session ? (session.headed ? 'headed' : 'headless') : null,
    };
  });
}

export async function closeIfOpen(account) {
  if (!(await findSession(account))) return false;
  await closeSession(account);
  return true;
}

export async function login(project, account, { log = console.log } = {}) {
  if (!process.stdin.isTTY) {
    throw new PwaError('login 需要交互式终端，请在自己的终端里执行（不要通过 agent 执行）');
  }
  // profile 同一时间只能被一个浏览器使用
  if (await closeIfOpen(account)) log(`已关闭原有会话 ${account.session}`);
  ensureProfileDir(project, account);
  await openSession(account, account.url, { headed: true });
  log(`已在浏览器窗口中打开 ${account.url}`);

  const how = await waitForLogin(account);
  // 窗口被手动关闭：Chromium 正常退出时已把登录态落盘，只是无法再校验
  if (how === 'closed') return { verified: false };
  const url = await currentUrl(account);
  await closeIfOpen(account);
  if (how === 'cancel') throw new PwaError('已取消登录');
  if (url === null) return { verified: false };
  if (isLoginPage(account, url)) throw new PwaError(`页面仍停留在登录页（${url}），登录未完成`, 3);
  return { verified: true, url };
}

// 页面进入过登录页、随后离开并稳定几秒，视为登录完成自动保存；任何时候也可以按回车保存。
// 返回 'auto' | 'enter' | 'closed'（窗口被关闭）| 'cancel'（Ctrl-C）
async function waitForLogin(account) {
  const ac = new AbortController();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const hint = account.loginPattern
    ? '完成登录（含验证码）后会自动保存，也可以随时按回车保存'
    : '完成登录（含验证码）后按回车保存';

  const byKey = new Promise((resolve) => {
    rl.on('SIGINT', () => resolve('cancel'));
    rl.question(`${hint}… `, { signal: ac.signal }).then(() => resolve('enter'), () => {});
  });
  const byPolling = (async () => {
    let sawLogin = false;
    let last = null;
    let stable = 0;
    while (!ac.signal.aborted) {
      await sleep(1000);
      if (ac.signal.aborted) return;
      const url = await currentUrl(account);
      if (url === null) {
        // 跳转途中 eval 可能失败，只有会话确实没了才算窗口被关闭
        if (!(await findSession(account))) return 'closed';
        continue;
      }
      if (isLoginPage(account, url)) {
        sawLogin = true;
        stable = 0;
      } else if (sawLogin) {
        stable = url === last ? stable + 1 : 0;
        if (stable >= 3) return 'auto';
      }
      last = url;
    }
  })();

  const how = await Promise.race([byKey, byPolling]);
  ac.abort();
  rl.close();
  await byPolling;
  if (how !== 'enter') process.stdout.write('\n');
  return how;
}

export async function open(account, target, { headed = false, warn = console.error } = {}) {
  if (!fs.existsSync(account.profile)) {
    throw new PwaError(`账号 ${account.name} 尚未登录过。请人工执行: pwa login ${account.name}`);
  }
  const url = resolveTarget(account, target);
  const session = await findSession(account);
  if (session) {
    if (headed && !session.headed) warn(`会话已以无界面方式打开，--headed 未生效；需要先 pwa close ${account.name}`);
    await gotoUrl(account, url);
  } else {
    await openSession(account, url, { headed });
  }
  // SPA 的路由守卫可能在 load 之后才跳到登录页，稍等再判断
  await sleep(1000);
  const current = await currentUrl(account);
  if (current && isLoginPage(account, current)) {
    throw new PwaError(
      `账号 ${account.name} 未登录或登录态已失效（当前页面 ${current}）。请人工执行: pwa login ${account.name}`,
      3,
    );
  }
  return current;
}

export async function reset(account) {
  await closeIfOpen(account);
  const existed = fs.existsSync(account.profile);
  fs.rmSync(account.profile, { recursive: true, force: true });
  return existed;
}

export function addAccount(project, name, { url, desc }) {
  const err = validateAccountName(project, name) ?? validateUrl(url);
  if (err) throw new PwaError(err);
  project.cfg.accounts[name] = desc ? { url, desc } : { url };
  saveProject(project);
}

export function updateAccount(project, name, { url, desc, loginPattern }) {
  const err = validateUrl(url) ?? validatePattern(loginPattern);
  if (err) throw new PwaError(err);
  project.cfg.accounts[name] = {
    url,
    ...(desc && { desc }),
    ...(loginPattern && { loginPattern }),
  };
  saveProject(project);
}

export async function removeAccount(project, account) {
  await reset(account);
  delete project.cfg.accounts[account.name];
  saveProject(project);
}

// 找出不再被任何项目使用的 profile：整个 id 目录（项目已删除、重新初始化或来源不明），
// 或者 id 目录下已从配置中移除的账号
export function scanStaleProfiles() {
  if (!fs.existsSync(PWA_HOME)) return [];
  const stale = [];
  for (const d of fs.readdirSync(PWA_HOME, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PWA_HOME, d.name);
    const projects = boundProjects(dir);
    // 绑定过的项目里，配置仍指向这个 id 的才算还在用
    const live = projects
      .map((root) => ({ root, cfg: readJson(path.join(root, CONFIG_DIR, CONFIG_FILE)) }))
      .filter((p) => p.cfg?.id === d.name);
    if (!projects.length) {
      stale.push({ dir, label: d.name, reason: '来源不明', orphan: false });
    } else if (!live.length) {
      stale.push({ dir, label: d.name, reason: `项目已删除或已重新初始化：${projects.join('、')}`, orphan: true });
    } else {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() && !live.some((p) => Object.hasOwn(p.cfg.accounts ?? {}, e.name))) {
          const where = live.map((p) => p.root).join('、');
          stale.push({ dir: path.join(dir, e.name), label: `${d.name}/${e.name}`, reason: `账号已从 ${where} 的配置中移除`, orphan: true });
        }
      }
    }
  }
  return stale;
}

// 仍有浏览器在用的目录跳过，避免删掉正被锁定的 profile
export async function deleteProfiles(dirs) {
  const inUse = (await listSessions({ all: true })).map((s) => s.userDataDir).filter(Boolean);
  const deleted = [];
  const skipped = [];
  for (const dir of dirs) {
    if (inUse.some((u) => u === dir || u.startsWith(dir + path.sep))) {
      skipped.push(dir);
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    deleted.push(dir);
  }
  return { deleted, skipped };
}
