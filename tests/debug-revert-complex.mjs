import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'tests', 'tmp_revert2');
const testFile = path.join(testDir, 'test.txt');

async function main() {
  fs.mkdirSync(testDir, { recursive: true });
  execSync('git init && git config user.email "t@t" && git config user.name "T"', { cwd: testDir, stdio: 'pipe' });

  // Original: 5 lines
  fs.writeFileSync(testFile, 'aaa\nbbb\nccc\nddd\neee\n');
  execSync('git add . && git commit -m "init"', { cwd: testDir, stdio: 'pipe' });

  // Modified: insert 2 lines after bbb, change ddd, delete eee
  // Result: aaa, bbb, NEW1, NEW2, ccc, DDD_CHANGED
  fs.writeFileSync(testFile, 'aaa\nbbb\nNEW1\nNEW2\nccc\nDDD_CHANGED\n');

  const app = await electron.launch({
    args: [path.join(rootDir, 'out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'development' }
  });
  const window = await app.firstWindow();
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`  [ERROR] ${msg.text()}`);
  });
  await window.waitForTimeout(2000);

  await window.evaluate(async (p) => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace'); const ui = pi._s.get('ui');
    const project = await ws.addProject(p);
    if (project) ui.addPane({ id: 'p1', terminalId: 'term-1', projectId: project.id, projectName: project.name, projectPath: project.path, agentId: null, title: project.name });
  }, testDir);
  await window.waitForTimeout(1000);

  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('test.txt')) { await item.click(); break; }
  }
  await window.waitForTimeout(2500);

  console.log('\n=== Complex diff: insert + modify + delete ===');
  let state = await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    return {
      content: pi._s.get('editor').activeFile?.content?.trim(),
      marks: document.querySelectorAll('.git-diff-mark').length
    };
  });
  console.log(`Content: ${state.content}`);
  console.log(`Marks: ${state.marks}`);

  // Revert the FIRST hunk (the inserted NEW1, NEW2 lines)
  console.log('\n=== Revert insertion hunk (NEW1, NEW2) ===');
  const mark = window.locator('.git-diff-mark').first();
  await mark.click();
  await window.waitForTimeout(500);

  const hunk = await window.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.hunk-line')).map(l => l.querySelector('.hunk-line-text')?.textContent);
    return lines;
  });
  console.log('Old content for this hunk:', hunk);

  await window.evaluate(() => document.querySelectorAll('.notify-item').forEach(n => n.remove()));
  await window.locator('.hunk-action.revert').click({ force: true });
  await window.waitForTimeout(1000);

  state = await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    return {
      content: pi._s.get('editor').activeFile?.content?.trim(),
      marks: document.querySelectorAll('.git-diff-mark').length
    };
  });
  console.log(`After revert:`);
  console.log(`Content: ${state.content}`);
  console.log(`Marks: ${state.marks}`);

  // Expected: aaa, bbb, ccc, DDD_CHANGED (NEW1/NEW2 removed, DDD_CHANGED still there, eee still deleted)
  const expected = 'aaa\nbbb\nccc\nDDD_CHANGED';
  console.log(`\nExpected: ${expected}`);
  console.log(`Match: ${state.content === expected}`);

  await app.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n=== Done ===');
}

main().catch(err => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.error('FAILED:', err);
  process.exit(1);
});
