import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const testFile = path.join(rootDir, 'tests', '_test_inline_diff.txt');

async function main() {
  // Setup: commit a file, then modify it
  fs.writeFileSync(testFile, 'alpha\nbeta\ngamma\ndelta\nepsilon\n');
  execSync('git add tests/_test_inline_diff.txt && git commit -m "inline diff test"', { cwd: rootDir, stdio: 'pipe' });
  fs.writeFileSync(testFile, 'alpha\nBETACHANGED\ngamma\nDELTACHANGED\nepsilon\n');

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
  }, rootDir);
  await window.waitForTimeout(1500);

  // Open test file
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('tests')) { await item.click(); break; }
  }
  await window.waitForTimeout(500);
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('_test_inline_diff.txt')) { await item.click(); break; }
  }
  await window.waitForTimeout(2500);

  console.log('\n=== Initial diff marks ===');
  let marks = await window.evaluate(() => document.querySelectorAll('.git-diff-mark').length);
  console.log(`Diff marks: ${marks}`);

  // Click on the first diff mark
  console.log('\n=== Click diff mark → inline diff ===');
  const diffMark = window.locator('.git-diff-mark').first();
  if (await diffMark.count() > 0) {
    await diffMark.click();
    await window.waitForTimeout(500);

    const inlineDiff = await window.evaluate(() => {
      const el = document.querySelector('.diff-hunk-inline');
      if (!el) return null;
      const lines = Array.from(el.querySelectorAll('.hunk-line')).map(l => ({
        num: l.querySelector('.hunk-line-num')?.textContent?.trim(),
        sign: l.querySelector('.hunk-line-sign')?.textContent?.trim(),
        text: l.querySelector('.hunk-line-text')?.textContent
      }));
      const hasRevert = !!el.querySelector('.hunk-action.revert');
      const hasClose = !!el.querySelector('.hunk-action.close');
      return { lineCount: lines.length, lines, hasRevert, hasClose };
    });

    console.log('Inline diff view:');
    console.log(`  Lines: ${inlineDiff?.lineCount}`);
    console.log(`  Revert button: ${inlineDiff?.hasRevert}`);
    console.log(`  Close button: ${inlineDiff?.hasClose}`);
    inlineDiff?.lines.forEach(l => console.log(`    ${l.num} ${l.sign} ${l.text}`));

    // Dismiss any notifications that might be covering the button
    await window.evaluate(() => {
      document.querySelectorAll('.notify-item').forEach(n => n.remove());
      const bar = document.querySelector('.notify-bar');
      if (bar) bar.remove();
    });
    await window.waitForTimeout(200);

    // Test revert
    console.log('\n=== Click Revert ===');
    await window.locator('.hunk-action.revert').click({ force: true });
    await window.waitForTimeout(500);

    const afterRevert = await window.evaluate(() => {
      const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ed = pi._s.get('editor');
      return {
        content: ed.activeFile?.content,
        diffMarks: document.querySelectorAll('.git-diff-mark').length,
        inlineClosed: !document.querySelector('.diff-hunk-inline')
      };
    });
    console.log('After revert:');
    console.log(`  Content: ${afterRevert.content?.trim()}`);
    console.log(`  Diff marks: ${afterRevert.diffMarks} (should be fewer)`);
    console.log(`  Inline closed: ${afterRevert.inlineClosed}`);
  }

  // Cleanup
  await app.close();
  execSync('git checkout -- tests/_test_inline_diff.txt && git rm -f tests/_test_inline_diff.txt && git commit -m "cleanup"', { cwd: rootDir, stdio: 'pipe' });
  console.log('\n=== Inline diff test complete ===');
}

main().catch(err => {
  try { execSync('git checkout -- tests/_test_inline_diff.txt 2>/dev/null; git rm -f tests/_test_inline_diff.txt 2>/dev/null; git commit -m "cleanup" 2>/dev/null', { cwd: rootDir, stdio: 'pipe' }); } catch {}
  console.error('FAILED:', err);
  process.exit(1);
});
