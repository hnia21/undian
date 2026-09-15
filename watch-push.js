'use strict';
// Auto-push ke GitHub otomatis saat ada perubahan file.
// Cara pakai: node watch-push.js  (biarkan terminal tetap terbuka)
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;

function git(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: DIR });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(out.trim() || `git ${args.join(' ')} exit ${code}`));
    });
  });
}

let busy = false;
async function pushIfChanges() {
  if (busy) return;
  try {
    const status = await git(['status', '--porcelain']);
    if (!status) {
      console.log('[watch-push] Tidak ada perubahan.');
      return;
    }
    busy = true;
    await git(['add', '-A']);
    await git(['commit', '-m', `Auto-commit ${new Date().toLocaleString('id-ID')}`]);
    await git(['push']);
    console.log('[watch-push] Perubahan ter-push ke GitHub.');
  } catch (e) {
    console.error('[watch-push] Gagal:', e.message);
  } finally {
    busy = false;
  }
}

let timer = null;
fs.watch(DIR, { recursive: true }, (event, filename) => {
  if (!filename) return;
  const p = filename.toString().replace(/\\/g, '/');
  if (p === '.git' || p.startsWith('.git/')) return; // abaikan folder .git agar tidak loop
  clearTimeout(timer);
  timer = setTimeout(pushIfChanges, 1500);
});

console.log('[watch-push] Menonton ' + DIR);
console.log('[watch-push] Perubahan file akan otomatis di-commit & di-push (delay 1.5 detik).');
pushIfChanges();