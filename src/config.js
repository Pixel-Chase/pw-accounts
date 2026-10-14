import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PWA_HOME, PwaError, readJson, writeJson } from './util.js';

export const CONFIG_DIR = '.playwright';
export const CONFIG_FILE = 'accounts.json';
// 记录 id 属于哪个项目，「清理」据此判断 profile 是否已成孤儿；以 . 开头，不会与账号名冲突
export const META_FILE = '.meta.json';
export const DEFAULT_LOGIN_PATTERN = '/login|/oauth|sso\\.';
// 账号名与子命令共用第一个参数位，不能重名
export const COMMANDS = ['init', 'list', 'login', 'open', 'close', 'reset', 'setup', 'doctor', 'help'];

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const configPath = (root) => path.join(root, CONFIG_DIR, CONFIG_FILE);

// 与 playwright-cli 划分工作区的规则一致：最近的含 .playwright 的祖先目录。
// 两边一致，pwa 与透传的 playwright-cli 命令才能看到同一批会话。
export function findProjectRoot(start = process.cwd()) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, CONFIG_DIR))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

export function loadProject() {
  const root = findProjectRoot();
  if (!root) {
    throw new PwaError(`未找到 ${CONFIG_DIR}/${CONFIG_FILE}（从 ${process.cwd()} 向上查找）。请在项目根目录执行 pwa 完成初始化`);
  }
  return readProject(root);
}

export function readProject(root) {
  const file = configPath(root);
  if (!fs.existsSync(file)) {
    throw new PwaError(`${path.join(root, CONFIG_DIR)} 下没有 ${CONFIG_FILE}，请在 ${root} 执行 pwa 完成初始化`);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new PwaError(`${file} 解析失败：${e.message}`);
  }
  if (typeof cfg.id !== 'string' || !ID_RE.test(cfg.id)) {
    throw new PwaError(`${file} 中的 id 无效（只允许小写字母、数字和 -）`);
  }
  cfg.accounts ??= {};
  return { root, file, cfg, home: path.join(PWA_HOME, cfg.id) };
}

export function saveProject(project) {
  writeJson(project.file, project.cfg);
}

export function createProject(root, { loginPattern = DEFAULT_LOGIN_PATTERN } = {}) {
  const file = configPath(root);
  if (fs.existsSync(file)) throw new PwaError(`${file} 已存在`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJson(file, { id: newId(root), loginPattern, accounts: {} });
  return readProject(root);
}

// 项目目录名 + 随机后缀：不会冲突，翻 ~/.pw-accounts 时也认得出是哪个项目
function newId(root) {
  const slug = path
    .basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const suffix = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return slug ? `${slug}-${suffix}` : suffix;
}

// 以下 validate* 返回错误信息，合法时返回 undefined（可直接用作 clack 的 validate）
export function validateAccountName(project, name) {
  if (!name) return '账号名不能为空';
  if (!ACCOUNT_RE.test(name)) return '只能包含字母、数字及 . _ -，且以字母或数字开头';
  if (COMMANDS.includes(name)) return `${name} 与 pwa 子命令重名`;
  if (project.cfg.accounts[name]) return `账号 ${name} 已存在`;
}

export function validateUrl(url) {
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) return '只支持 http / https 地址';
  } catch {
    return '不是合法的 URL';
  }
}

export function validatePattern(pattern) {
  if (!pattern) return;
  try {
    new RegExp(pattern);
  } catch (e) {
    return `正则无效：${e.message}`;
  }
}

export function getAccount(project, name) {
  const entry = name && Object.hasOwn(project.cfg.accounts, name) && project.cfg.accounts[name];
  if (!entry) {
    if (!name) throw new PwaError('缺少账号名');
    const names = Object.keys(project.cfg.accounts).join(', ') || '（无）';
    throw new PwaError(`账号 ${name} 不在 ${project.file} 中，可用：${names}`);
  }
  if (!ACCOUNT_RE.test(name)) throw new PwaError(`账号名 ${name} 不合法`);
  if (validateUrl(entry.url ?? '')) throw new PwaError(`账号 ${name} 的 url 无效：${entry.url}`);
  const loginPattern = entry.loginPattern || project.cfg.loginPattern || '';
  const err = validatePattern(loginPattern);
  if (err) throw new PwaError(`账号 ${name} 的 loginPattern ${err}`);
  return {
    name,
    url: entry.url,
    desc: entry.desc ?? '',
    loginPattern,
    profile: path.join(project.home, name),
    // playwright-cli 的会话按工作区隔离，账号名本身即可作为会话名
    session: name,
  };
}

export function isLoginPage(account, url) {
  return Boolean(account.loginPattern) && new RegExp(account.loginPattern).test(url);
}

// 相对路径拼到账号入口的 origin 上，保证 localStorage 落在同一个 origin
export function resolveTarget(account, target) {
  if (!target) return account.url;
  if (/^https?:\/\//.test(target)) return target;
  return `${new URL(account.url).origin}/${target.replace(/^\/+/, '')}`;
}

export function ensureProfileDir(project, account) {
  fs.mkdirSync(account.profile, { recursive: true });
  for (const dir of [PWA_HOME, project.home, account.profile]) fs.chmodSync(dir, 0o700);
  const metaFile = path.join(project.home, META_FILE);
  if (readJson(metaFile)?.project !== project.root) writeJson(metaFile, { project: project.root });
}
