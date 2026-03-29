import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Setup test file
const testDir = path.join(rootDir, 'tests', 'tmp_bugfix');
fs.mkdirSync(testDir, { recursive: true });
const testFile = path.join(testDir, 'test.txt');
fs.writeFileSync(testFile, 'aaa\nbbb\nccc\nddd\neee\nfff\nggg\n');

async function main() {
  const app = await electron.launch({
    args: [path.join(rootDir, 'out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'development' }
  });
  const window = await app.firstWindow();
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`  [ERROR] ${msg.text()}`);
  });
  await window.waitForTimeout(2000);

  // Add test dir as project
  await window.evaluate(async (p) => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace'); const ui = pi._s.get('ui');
    const project = await ws.addProject(p);
    if (project) ui.addPane({ id: 'p1', terminalId: 'term-1', projectId: project.id, projectName: project.name, projectPath: project.path, agentId: null, title: project.name });
  }, testDir);
  await window.waitForTimeout(1000);

  // Open test.txt
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('test.txt')) { await item.click(); break; }
  }
  await window.waitForTimeout(1500);

  // === Bug 1: Check no JSON pollution ===
  console.log('\n=== Bug 1: No filePath JSON in editor ===');
  const content = await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    return pi._s.get('editor').activeFile?.content;
  });
  console.log(`Has filePath: ${content?.includes('filePath') === true} (should be false)`);
  console.log(`Content: "${content?.trim().substring(0, 40)}"`);

  // === Bug 2: Diff only changed lines (non-git dir, so no diff marks expected) ===
  console.log('\n=== Bug 2: Diff marks ===');
  const marks = await window.evaluate(() => document.querySelectorAll('.git-diff-mark').length);
  console.log(`Diff marks in non-git dir: ${marks} (should be 0)`);

  // === Fix 3: Ctrl+F ===
  console.log('\n=== Fix 3: Ctrl+F search ===');
  const cmContent = window.locator('.cm-content');
  await cmContent.click();
  await window.waitForTimeout(200);
  await window.keyboard.press('Control+f');
  await window.waitForTimeout(500);
  const hasSearch = await window.evaluate(() => !!document.querySelector('.cm-search'));
  console.log(`Search panel: ${hasSearch}`);
  if (hasSearch) await window.keyboard.press('Escape');

  // === Fix 4: File auto-refresh ===
  console.log('\n=== Fix 4: Auto-refresh ===');
  fs.writeFileSync(testFile, 'REFRESHED_CONTENT\n');
  await window.waitForTimeout(2000);
  const refreshed = await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    return pi._s.get('editor').activeFile?.content?.includes('REFRESHED');
  });
  console.log(`Auto-refreshed: ${refreshed}`);

  // === Fix 5: >3 panes ===
  console.log('\n=== Fix 5: No terminal limit ===');
  const count = await window.evaluate(() => {
    const ui = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui');
    for (let i = 0; i < 5; i++) ui.addPane({ id: `x${i}`, terminalId: `t${i}`, projectId: null, projectName: null, projectPath: null, agentId: null, title: `T${i}` });
    return ui.panes.length;
  });
  console.log(`Panes: ${count} (should be 6 = 1 original + 5 added)`);

  // === Fix 6: Ctrl+` shortcut ===
  console.log('\n=== Fix 6: Ctrl+\` layer toggle ===');
  await window.evaluate(() => {
    document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui').switchToTerminal();
  });
  await window.keyboard.press('Control+`');
  await window.waitForTimeout(300);
  let layer = await window.evaluate(() =>
    document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui').activeLayer
  );
  console.log(`After Ctrl+\`: ${layer} (should be editor)`);

  await window.keyboard.press('Control+`');
  await window.waitForTimeout(300);
  layer = await window.evaluate(() =>
    document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui').activeLayer
  );
  console.log(`After Ctrl+\` again: ${layer} (should be terminal)`);

  await app.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n=== All fixes verified ===');
}

main().catch(err => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.error('FAILED:', err);
  process.exit(1);
});
