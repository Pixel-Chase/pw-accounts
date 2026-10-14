import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import {
  DEFAULT_LOGIN_PATTERN,
  configPath,
  createProject,
  findProjectRoot,
  getAccount,
  readProject,
  validateAccountName,
  validatePattern,
  validateUrl,
} from './config.js';
import {
  accountStatus,
  addAccount,
  closeIfOpen,
  deleteProfiles,
  login,
  open,
  removeAccount,
  reset,
  scanStaleProfiles,
  updateAccount,
} from './ops.js';
import { closeSession, findSession } from './pwcli.js';
import { doctor, pendingSetup, setup } from './setup.js';
import { PwaError, tildify } from './util.js';

// clack 的提示在取消（Esc / Ctrl-C）时返回特殊值，统一转成 null
async function ask(prompt) {
  const v = await prompt;
  return p.isCancel(v) ? null : v;
}

const SESSION_LABEL = { headless: '无界面运行中', headed: '有界面运行中' };

export async function runTui() {
  p.intro(' pwa · Playwright 多账号 ');
  // npm i -g 之后直接执行 pwa 即可，不必记得先 pwa setup；升级后 skill 有变化也会在这里补上
  const pending = await pendingSetup();
  if (pending.length) {
    p.log.warn(`还需要完成安装：${pending.join('，')}`);
    if (await ask(p.confirm({ message: '现在执行 pwa setup？' }))) await setup(p.log.info);
  }
  let project = await ensureProject();
  while (project) {
    const n = Object.keys(project.cfg.accounts).length;
    const action = await ask(
      p.select({
        message: `${path.basename(project.root)} · ${n} 个账号`,
        options: [
          { value: showStatus, label: '查看账号' },
          { value: loginFlow, label: '登录账号', hint: '弹出浏览器窗口，人工登录' },
          { value: addFlow, label: '添加账号' },
          { value: editFlow, label: '修改账号' },
          { value: removeFlow, label: '删除账号' },
          { value: watchFlow, label: '打开浏览器旁观', hint: '有界面打开，可以看着 agent 操作' },
          { value: closeFlow, label: '关闭会话' },
          { value: pruneFlow, label: '清理无用的登录态' },
          { value: doctorFlow, label: '环境检查' },
          { value: null, label: '退出' },
        ],
      }),
    );
    if (!action) break;
    try {
      await action(project);
    } catch (e) {
      if (!(e instanceof PwaError)) throw e;
      p.log.error(e.message);
    }
    project = readProject(project.root);
  }
  p.outro('再见');
  return 0;
}

async function ensureProject() {
  const root = findProjectRoot();
  if (root && fs.existsSync(configPath(root))) return readProject(root);

  p.log.warn('当前目录还没有初始化 pwa');
  // 已有 .playwright 目录时只能在那里初始化，否则 playwright-cli 判定的工作区会和 pwa 不一致
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const candidates = root ? [root] : [...new Set([git.status === 0 && git.stdout.trim(), process.cwd()].filter(Boolean))];
  const dir = await ask(
    p.select({
      message: '在哪个目录初始化？',
      options: [...candidates.map((d) => ({ value: d, label: tildify(d) })), { value: null, label: '取消' }],
    }),
  );
  if (!dir) return null;
  const loginPattern = await ask(
    p.text({
      message: '登录页地址特征（正则，页面 URL 匹配即视为未登录；留空则不检测）',
      initialValue: DEFAULT_LOGIN_PATTERN,
      validate: (v) => validatePattern(v?.trim()),
    }),
  );
  if (loginPattern === null) return null;

  const project = createProject(dir, { loginPattern: (loginPattern ?? '').trim() });
  p.log.success(`已创建 ${tildify(project.file)}（id: ${project.cfg.id}）`);
  await addFlow(project);
  return readProject(dir);
}

async function pickAccount(project, message, { onlyLoggedIn = false } = {}) {
  const status = (await accountStatus(project)).filter((s) => !onlyLoggedIn || s.hasProfile);
  if (!status.length) {
    p.log.warn(onlyLoggedIn ? '还没有登录过的账号，先「登录账号」' : '还没有账号，先「添加账号」');
    return null;
  }
  const name = await ask(
    p.select({
      message,
      options: status.map((s) => ({
        value: s.name,
        label: s.name,
        hint: [s.desc, !s.hasProfile && '未登录', s.session && SESSION_LABEL[s.session]].filter(Boolean).join(' · '),
      })),
    }),
  );
  return name && getAccount(project, name);
}

async function showStatus(project) {
  const status = await accountStatus(project);
  const width = Math.max(8, ...status.map((s) => s.name.length));
  const lines = status.map((s) =>
    [
      s.name.padEnd(width),
      s.hasProfile ? '有登录态' : '未登录  ',
      s.session ? SESSION_LABEL[s.session] : '会话未打开  ',
      s.url,
      s.desc,
    ].join('  '),
  );
  p.note(
    [`配置    ${tildify(project.file)}`, `登录态  ${tildify(project.home)}`, '', ...(lines.length ? lines : ['（还没有账号）'])].join('\n'),
    `id: ${project.cfg.id}`,
  );
}

async function addFlow(project) {
  const name = await ask(
    p.text({
      message: '账号名（建议 <环境>-<角色>，如 test-admin）',
      validate: (v) => validateAccountName(project, v?.trim()),
    }),
  );
  if (name === null) return;
  const url = await ask(
    p.text({ message: '入口地址', placeholder: 'https://test.example.com/', validate: (v) => validateUrl(v?.trim() ?? '') }),
  );
  if (url === null) return;
  const desc = await ask(p.text({ message: '说明（可选）', placeholder: 'test 环境管理员' }));
  if (desc === null) return;

  addAccount(project, name.trim(), { url: url.trim(), desc: desc?.trim() });
  p.log.success(`已添加账号 ${name.trim()}`);
  if (await ask(p.confirm({ message: '现在登录这个账号？' }))) await loginFlow(project, name.trim());
}

async function editFlow(project) {
  const account = await pickAccount(project, '修改哪个账号？');
  if (!account) return;
  const entry = project.cfg.accounts[account.name];
  const url = await ask(p.text({ message: '入口地址', initialValue: entry.url, validate: (v) => validateUrl(v?.trim() ?? '') }));
  if (url === null) return;
  const desc = await ask(p.text({ message: '说明', initialValue: entry.desc ?? '' }));
  if (desc === null) return;
  const loginPattern = await ask(
    p.text({
      message: '登录页地址特征（仅对该账号生效）',
      initialValue: entry.loginPattern ?? '',
      placeholder: `留空则使用项目默认：${project.cfg.loginPattern || '不检测'}`,
      validate: (v) => validatePattern(v?.trim()),
    }),
  );
  if (loginPattern === null) return;

  updateAccount(project, account.name, { url: url.trim(), desc: desc?.trim(), loginPattern: loginPattern?.trim() });
  p.log.success(`已更新账号 ${account.name}`);
  if (fs.existsSync(account.profile) && new URL(url.trim()).origin !== new URL(entry.url).origin) {
    p.log.warn('入口的 origin 变了，原有登录态不再适用，需要重新登录');
  }
}

async function removeFlow(project) {
  const account = await pickAccount(project, '删除哪个账号？');
  if (!account) return;
  if (!(await ask(p.confirm({ message: `删除账号 ${account.name}？配置和登录态都会删除`, initialValue: false })))) return;
  await removeAccount(project, account);
  p.log.success(`已删除账号 ${account.name}`);
}

async function loginFlow(project, name) {
  const account = name ? getAccount(project, name) : await pickAccount(project, '登录哪个账号？');
  if (!account) return;
  if (fs.existsSync(account.profile)) {
    const mode = await ask(
      p.select({
        message: '该账号已有登录态',
        options: [
          { value: 'keep', label: '直接打开窗口', hint: 'SSO 仍有效时通常会自动跳回业务页面' },
          { value: 'reset', label: '清空后重新登录', hint: '一直提示登录态失效时用' },
        ],
      }),
    );
    if (!mode) return;
    if (mode === 'reset') await reset(account);
  }
  const result = await login(project, account, { log: p.log.info });
  if (result.verified) p.log.success(`账号 ${account.name} 已登录，登录态已保存`);
  else p.log.warn(`浏览器窗口已关闭，登录态已保存，但没能确认是否登录成功`);
}

async function watchFlow(project) {
  const account = await pickAccount(project, '打开哪个账号？', { onlyLoggedIn: true });
  if (!account) return;
  const session = await findSession(account);
  if (session && !session.headed) {
    const ok = await ask(
      p.confirm({ message: '该账号正以无界面方式运行（可能是 agent 在用），关闭后以有界面方式重新打开？' }),
    );
    if (!ok) return;
    await closeSession(account);
  }
  const target = await ask(p.text({ message: '打开的路径或 URL（可选）', placeholder: '/order/list，留空打开入口地址' }));
  if (target === null) return;
  const url = await open(account, target?.trim(), { headed: true, warn: p.log.warn });
  p.log.success(`已打开 ${url}。用完记得在菜单里「关闭会话」`);
}

async function closeFlow(project) {
  const opened = (await accountStatus(project)).filter((s) => s.session);
  if (!opened.length) {
    p.log.info('没有打开的会话');
    return;
  }
  const names = await ask(
    p.multiselect({
      message: '关闭哪些会话？',
      options: opened.map((s) => ({ value: s.name, label: s.name, hint: SESSION_LABEL[s.session] })),
      initialValues: opened.map((s) => s.name),
    }),
  );
  for (const name of names ?? []) {
    await closeIfOpen(getAccount(project, name));
    p.log.success(`已关闭 ${name}`);
  }
}

async function pruneFlow() {
  const stale = scanStaleProfiles();
  if (!stale.length) {
    p.log.success('没有需要清理的登录态');
    return;
  }
  const dirs = await ask(
    p.multiselect({
      message: '以下登录态已不属于任何项目的账号，选择要删除的',
      options: stale.map((s) => ({ value: s.dir, label: s.label, hint: s.reason })),
      initialValues: stale.filter((s) => s.orphan).map((s) => s.dir),
      required: false,
    }),
  );
  if (!dirs?.length) return;
  const { deleted, skipped } = await deleteProfiles(dirs);
  for (const d of deleted) p.log.success(`已删除 ${tildify(d)}`);
  for (const d of skipped) p.log.warn(`${tildify(d)} 仍有浏览器在使用，已跳过`);
}

async function doctorFlow() {
  const checks = await doctor();
  for (const c of checks) {
    if (c.ok) p.log.success(`${c.name}：${c.detail}`);
    else p.log.warn(`${c.name}：${c.detail}\n${c.fix}`);
  }
  if (checks.some((c) => !c.ok && c.fix === '执行 pwa setup') && (await ask(p.confirm({ message: '现在执行 pwa setup？' })))) {
    await setup(p.log.info);
  }
}
