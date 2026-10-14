import { assertBound, bindingState, createProject, getAccount, loadProject } from './config.js';
import { accountStatus, closeIfOpen, login, open, reset } from './ops.js';
import { findSession, pwcli } from './pwcli.js';
import { doctor, setup } from './setup.js';
import { runTui } from './tui.js';
import { PwaError, tildify } from './util.js';

const USAGE = `用法:
  pwa                             交互式菜单：初始化、查看 / 添加 / 修改 / 删除 / 登录账号、清理等
  pwa setup                       安装后执行一次：下载 Chromium、安装 agent skill、写入全局 gitignore
  pwa doctor                      环境检查
  pwa init                        在当前目录创建 .playwright/accounts.json
  pwa list                        列出当前项目的账号、登录态与会话
  pwa login <account>             [人工] 有界面打开账号入口，登录后自动保存（或按回车保存）
  pwa open <account> [path|url]   [agent] 无界面打开（已打开则跳转），检测到登录页时退出码为 3
                                  加 --headed 以有界面方式打开，便于人工旁观
  pwa close <account>             正常关闭会话（务必用它关闭，强杀可能丢失最新刷新的 token）
  pwa reset <account>             删除该账号的登录态
  pwa <account> <cli 命令...>     透传给 playwright-cli，如: pwa test-admin snapshot`;

const SESSION_LABEL = { headless: '无界面', headed: '有界面' };

// 会用到登录态的命令都先确认当前项目有权使用这个 id 的登录态
function loadBoundProject() {
  const project = loadProject();
  assertBound(project);
  return project;
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd) {
    if (process.stdin.isTTY && process.stdout.isTTY) return runTui();
    console.log(USAGE);
    return 0;
  }

  switch (cmd) {
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE);
      return 0;

    case 'setup':
      await setup();
      return printDoctor();

    case 'doctor':
      return printDoctor();

    case 'init': {
      const project = createProject(process.cwd());
      console.log(`已创建 ${project.file}（id: ${project.cfg.id}）\n执行 pwa 添加账号，或直接编辑该文件`);
      return 0;
    }

    case 'list': {
      const project = loadProject();
      const status = await accountStatus(project);
      console.log(`配置: ${project.file}`);
      console.log(`登录态: ${tildify(project.home)}`);
      if (bindingState(project) === 'foreign') console.log('  ⚠ 这些登录态不属于当前项目，无权使用，需要在终端执行 pwa 确认');
      const width = Math.max(8, ...status.map((s) => s.name.length));
      for (const s of status) {
        const profile = s.hasProfile ? '有登录态' : '未登录  ';
        const session = s.session ? `${SESSION_LABEL[s.session]}会话` : '未打开  ';
        console.log(`  ${s.name.padEnd(width)}  ${profile}  ${session}  ${s.url}  ${s.desc}`);
      }
      if (!status.length) console.log('  （还没有账号，执行 pwa 添加）');
      return 0;
    }

    case 'login': {
      const project = loadBoundProject();
      const account = getAccount(project, rest[0]);
      const result = await login(project, account);
      console.log(
        result.verified
          ? `账号 ${account.name} 已登录，登录态已保存到 ${account.profile}`
          : `浏览器窗口已关闭，登录态已保存到 ${account.profile}，但没能确认是否登录成功`,
      );
      return 0;
    }

    case 'open': {
      const headed = rest.includes('--headed');
      const [name, target] = rest.filter((a) => a !== '--headed');
      const account = getAccount(loadBoundProject(), name);
      const url = await open(account, target, { headed, warn: (m) => console.error(`pwa: ${m}`) });
      console.log(`会话 ${account.session} 已就绪: ${url}`);
      console.log(`后续操作: pwa ${account.name} <snapshot|click|screenshot|...>`);
      return 0;
    }

    case 'close': {
      const account = getAccount(loadBoundProject(), rest[0]);
      console.log((await closeIfOpen(account)) ? `已关闭 ${account.session}` : `${account.session} 未打开`);
      return 0;
    }

    case 'reset': {
      const account = getAccount(loadBoundProject(), rest[0]);
      console.log((await reset(account)) ? `已删除 ${account.profile}` : `${account.profile} 不存在`);
      return 0;
    }

    default: {
      const account = getAccount(loadBoundProject(), cmd);
      // 不让 playwright-cli 自己报“未打开”：它会提示直接 playwright-cli open，绕过 profile
      if (!rest.includes('--help') && !(await findSession(account))) throw new PwaError(`会话 ${account.session} 未打开，先执行: pwa open ${account.name}`);
      return (await pwcli([`-s=${account.session}`, ...rest], { inherit: true })).code;
    }
  }
}

async function printDoctor() {
  const checks = await doctor();
  for (const c of checks) {
    console.log(`${c.ok ? '✔' : '✘'} ${c.name}：${c.detail}`);
    if (!c.ok) console.log(`    ${c.fix}`);
  }
  return checks.every((c) => c.ok) ? 0 : 1;
}
