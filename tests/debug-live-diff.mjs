import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function main() {
  // Create a test file with known content in a git repo
  const testFile = path.join(rootDir, 'tests', '_test_live_diff.txt');

  // First commit a version via git
  const { execSync } = await import('child_process');
  fs.writeFileSync(testFile, 'line1\nline2\nline3\nline4\nline5\n');
  execSync('git add tests/_test_live_diff.txt && git commit -m "test file for live diff"', { cwd: rootDir, stdio: 'pipe' });

  // Now modify it (so git diff will show changes)
  fs.writeFileSync(testFile, 'line1\nMODIFIED\nline3\nline4\nline5\n');

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
  }, rootDir);
  await window.waitForTimeout(1500);

  // Expand tests dir and open the file
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('tests')) { await item.click(); break; }
  }
  await window.waitForTimeout(500);
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('_test_live_diff.txt')) { await item.click(); break; }
  }
  await window.waitForTimeout(2000);

  // Check initial diff marks (line 2 is modified)
  console.log('\n=== Initial state: line2 is "MODIFIED" ===');
  let marks = await window.evaluate(() => document.querySelectorAll('.git-diff-mark').length);
  console.log(`Diff marks: ${marks} (should be 1, only line 2 changed)`);

  // Now revert the content back to original in the editor
  console.log('\n=== Revert line2 back to "line2" ===');
  await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ed = pi._s.get('editor');
    // Find the editor group and update content
    const groups = Object.values(ed.groups);
    for (const g of groups) {
      if (g.activeFile && g.activeFile.includes('_test_live_diff')) {
        ed.updateContent(g.activeFile, 'line1\nline2\nline3\nline4\nline5\n');
        break;
      }
    }
  });

  // We need to update the CM editor content too
  // Simpler: select all and type the original content
  const cmContent = window.locator('.cm-content');
  await cmContent.click();
  await window.keyboard.press('Meta+a');
  await window.keyboard.type('line1\nline2\nline3\nline4\nline5\n', { delay: 5 });
  await window.waitForTimeout(500);

  marks = await window.evaluate(() => document.querySelectorAll('.git-diff-mark').length);
  console.log(`Diff marks after revert: ${marks} (should be 0, content matches HEAD)`);

  // Modify again
  console.log('\n=== Modify lines 3-4 ===');
  await cmContent.click();
  await window.keyboard.press('Meta+a');
  await window.keyboard.type('line1\nline2\nCHANGED3\nCHANGED4\nline5\n', { delay: 5 });
  await window.waitForTimeout(500);

  marks = await window.evaluate(() => document.querySelectorAll('.git-diff-mark').length);
  console.log(`Diff marks: ${marks} (should be 2, lines 3-4 changed)`);

  // Cleanup
  await app.close();
  execSync('git rm -f tests/_test_live_diff.txt && git commit -m "remove test file"', { cwd: rootDir, stdio: 'pipe' });
  console.log('\n=== Live diff test complete ===');
}

main().catch(err => {
  const { execSync } = require('child_process');
  try { execSync('git checkout -- tests/_test_live_diff.txt && git rm -f tests/_test_live_diff.txt && git commit -m "cleanup"', { cwd: rootDir, stdio: 'pipe' }); } catch {}
  console.error('FAILED:', err);
  process.exit(1);
});
