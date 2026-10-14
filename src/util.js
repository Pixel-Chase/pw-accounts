import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PWA_HOME = process.env.PWA_HOME || path.join(os.homedir(), '.pw-accounts');

// code 3 表示页面落在登录页：agent 据此停下来，请用户重新 pwa login
export class PwaError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export const tildify = (p) => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);
