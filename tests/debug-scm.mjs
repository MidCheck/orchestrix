import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'tests', 'tmp_scm');

async function main() {
  // Setup git repo
  fs.mkdirSync(testDir, { recursive: true });
  execSync('git init && git config user.email "t@t" && git config user.name "T"', { cwd: testDir, stdio: 'pipe' });

  // Original file
  fs.writeFileSync(path.join(testDir, 'test.txt'), 'line1\nline2\nline3\nline4\nline5\nline6\n');
  execSync('git add . && git commit -m "init"', { cwd: testDir, stdio: 'pipe' });

  // Modified: add lines, modify line, delete line
  // line1 (unchanged), NEW_LINE (added), line2 (unchanged), LINE3_MOD (modified), line4 (unchanged), (line5 deleted), line6 (unchanged)
  fs.writeFileSync(path.join(testDir, 'test.txt'), 'line1\nNEW_LINE\nline2\nLINE3_MOD\nline4\nline6\n');

  // File with merge conflicts
  fs.writeFileSync(path.join(testDir, 'conflict.txt'),
    'normal line\n<<<<<<< HEAD\ncurrent version A\ncurrent version B\n=======\nincoming version X\nincoming version Y\n>>>>>>> feature-branch\nend line\n'
  );

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

  // === Test 1: Gutter colors ===
  console.log('\n=== Test 1: Gutter Colors (green/blue/red) ===');
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('test.txt')) { await item.click(); break; }
  }
  await window.waitForTimeout(2500);

  const gutterResult = await window.evaluate(() => ({
    added: document.querySelectorAll('.git-gutter-added').length,
    modified: document.querySelectorAll('.git-gutter-modified').length,
    deleted: document.querySelectorAll('.git-gutter-deleted').length,
  }));
  console.log(`Green (added): ${gutterResult.added}`);
  console.log(`Blue (modified): ${gutterResult.modified}`);
  console.log(`Red triangle (deleted): ${gutterResult.deleted}`);

  // === Test 2: Merge conflict detection ===
  console.log('\n=== Test 2: Merge Conflict Detection ===');
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('conflict.txt')) { await item.click(); break; }
  }
  await window.waitForTimeout(1500);

  const conflictResult = await window.evaluate(() => ({
    hasActions: !!document.querySelector('.merge-conflict-actions'),
    actionButtons: Array.from(document.querySelectorAll('.conflict-action')).map(el => el.textContent?.trim()),
    currentHighlight: document.querySelectorAll('.merge-conflict-current').length,
    incomingHighlight: document.querySelectorAll('.merge-conflict-incoming').length,
    markerLines: document.querySelectorAll('.merge-conflict-marker-line').length,
    hasMergeBtn: !!document.querySelector('.diff-btn.merge'),
  }));
  console.log(`Inline actions: ${conflictResult.hasActions}`);
  console.log(`Action buttons: ${conflictResult.actionButtons.join(', ')}`);
  console.log(`Current highlight lines: ${conflictResult.currentHighlight}`);
  console.log(`Incoming highlight lines: ${conflictResult.incomingHighlight}`);
  console.log(`Marker lines (<<<, ===, >>>): ${conflictResult.markerLines}`);
  console.log(`Merge Editor button: ${conflictResult.hasMergeBtn}`);

  // === Test 3: Accept Current Change ===
  console.log('\n=== Test 3: Accept Current Change ===');
  const acceptBtn = window.locator('.accept-current').first();
  if (await acceptBtn.count() > 0) {
    await acceptBtn.click();
    await window.waitForTimeout(500);

    const afterAccept = await window.evaluate(() => {
      const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      return pi._s.get('editor').activeFile?.content;
    });
    console.log(`Content after Accept Current:`);
    console.log(afterAccept?.trim());
    console.log(`Contains conflict markers: ${afterAccept?.includes('<<<<<<<')}`);
    console.log(`Contains "current version": ${afterAccept?.includes('current version')}`);
    console.log(`Does NOT contain "incoming version": ${!afterAccept?.includes('incoming version')}`);
  }

  // === Test 4: Three-way Merge Editor ===
  console.log('\n=== Test 4: Three-way Merge Editor ===');
  // Recreate conflict file
  fs.writeFileSync(path.join(testDir, 'conflict.txt'),
    'before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> branch\nafter\n'
  );
  // Reopen file
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('conflict.txt')) { await item.click(); break; }
  }
  await window.waitForTimeout(2000);

  // Click Merge Editor button
  const mergeBtn = window.locator('.diff-btn.merge');
  if (await mergeBtn.count() > 0) {
    await mergeBtn.click();
    await window.waitForTimeout(1000);

    const mergeResult = await window.evaluate(() => ({
      hasMergeEditor: !!document.querySelector('.merge-editor'),
      hasToolbar: !!document.querySelector('.merge-toolbar'),
      conflictCounter: document.querySelector('.conflict-counter')?.textContent?.trim(),
      completeDisabled: document.querySelector('.complete-btn')?.hasAttribute('disabled'),
      paneLabels: Array.from(document.querySelectorAll('.pane-label')).map(el => el.textContent?.trim()),
    }));
    console.log(`Merge Editor open: ${mergeResult.hasMergeEditor}`);
    console.log(`Toolbar: ${mergeResult.hasToolbar}`);
    console.log(`Conflict counter: ${mergeResult.conflictCounter}`);
    console.log(`Complete disabled (has conflicts): ${mergeResult.completeDisabled}`);
    console.log(`Pane labels: ${mergeResult.paneLabels.join(', ')}`);
  }

  await app.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n=== All SCM tests complete ===');
}

main().catch(err => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.error('FAILED:', err);
  process.exit(1);
});
