import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const testFile = path.join(rootDir, 'tests', 'tmp_revert', 'test.txt');
const testDir = path.dirname(testFile);

async function main() {
  // Setup: create git repo with a known file, then modify specific lines
  fs.mkdirSync(testDir, { recursive: true });

  // Init a temp git repo
  execSync('git init', { cwd: testDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com" && git config user.name "Test"', { cwd: testDir, stdio: 'pipe' });

  // Commit original
  fs.writeFileSync(testFile, 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n');
  execSync('git add . && git commit -m "initial"', { cwd: testDir, stdio: 'pipe' });

  // Modify lines 3 and 6 (two separate hunks)
  fs.writeFileSync(testFile, 'line1\nline2\nLINE3_CHANGED\nline4\nline5\nLINE6_CHANGED\nline7\nline8\n');

  const app = await electron.launch({
    args: [path.join(rootDir, 'out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'development' }
  });
  const window = await app.firstWindow();
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`  [ERROR] ${msg.text()}`);
  });
  await window.waitForTimeout(2000);

  // Add project
  await window.evaluate(async (p) => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace'); const ui = pi._s.get('ui');
    const project = await ws.addProject(p);
    if (project) ui.addPane({ id: 'p1', terminalId: 'term-1', projectId: project.id, projectName: project.name, projectPath: project.path, agentId: null, title: project.name });
  }, testDir);
  await window.waitForTimeout(1000);

  // Open file
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('test.txt')) { await item.click(); break; }
  }
  await window.waitForTimeout(2500);

  // Check initial state
  console.log('\n=== Initial State ===');
  let state = await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const content = pi._s.get('editor').activeFile?.content;
    const marks = document.querySelectorAll('.git-diff-mark').length;
    return { content, marks };
  });
  console.log(`Content: ${JSON.stringify(state.content?.trim())}`);
  console.log(`Diff marks: ${state.marks}`);

  // Click first diff mark to open inline diff
  console.log('\n=== Click first diff mark ===');
  const diffMark = window.locator('.git-diff-mark').first();
  if (await diffMark.count() > 0) {
    await diffMark.click();
    await window.waitForTimeout(500);

    const hunkView = await window.evaluate(() => {
      const el = document.querySelector('.diff-hunk-inline');
      if (!el) return null;
      const lines = Array.from(el.querySelectorAll('.hunk-line')).map(l => l.querySelector('.hunk-line-text')?.textContent);
      return { lines, hasRevert: !!el.querySelector('.hunk-action.revert') };
    });
    console.log('Old lines:', hunkView?.lines);
    console.log('Has revert:', hunkView?.hasRevert);

    // Click revert
    console.log('\n=== Revert first hunk ===');
    await window.evaluate(() => {
      document.querySelectorAll('.notify-item').forEach(n => n.remove());
    });
    await window.locator('.hunk-action.revert').click({ force: true });
    await window.waitForTimeout(1000);

    state = await window.evaluate(() => {
      const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const content = pi._s.get('editor').activeFile?.content;
      const marks = document.querySelectorAll('.git-diff-mark').length;
      return { content, marks };
    });
    console.log(`After revert:`);
    console.log(`Content: ${JSON.stringify(state.content?.trim())}`);
    console.log(`Diff marks: ${state.marks}`);

    // Verify: line3 should be reverted to "line3", line6 should still be "LINE6_CHANGED"
    const lines = state.content?.split('\n') || [];
    const line3ok = lines[2] === 'line3';
    const line6ok = lines[5] === 'LINE6_CHANGED';
    console.log(`\nLine 3 reverted to "line3": ${line3ok}`);
    console.log(`Line 6 still "LINE6_CHANGED": ${line6ok}`);
    console.log(`Diff marks reduced: ${state.marks < 2}`);

    if (line3ok && line6ok) {
      console.log('\n✅ Revert works correctly - only reverted the clicked hunk!');
    } else {
      console.log('\n❌ Revert is broken');
      console.log('Expected: line1\\nline2\\nline3\\nline4\\nline5\\nLINE6_CHANGED\\nline7\\nline8');
    }
  } else {
    console.log('No diff marks found');
  }

  await app.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n=== Done ===');
}

main().catch(err => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.error('FAILED:', err);
  process.exit(1);
});
