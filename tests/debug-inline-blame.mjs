import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

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

  await window.evaluate(async (p) => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace'); const ui = pi._s.get('ui');
    const project = await ws.addProject(p);
    if (project) ui.addPane({ id: 'p1', terminalId: 'term-1', projectId: project.id, projectName: project.name, projectPath: project.path, agentId: null, title: project.name });
  }, rootDir);
  await window.waitForTimeout(1500);

  // Open README.md
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('README.md')) { await item.click(); break; }
  }
  await window.waitForTimeout(2500);

  // === Test 1: Inline blame appears on cursor line ===
  console.log('\n=== Test 1: Inline blame ===');
  // Click on a line in the editor
  const content = window.locator('.cm-content');
  await content.click();
  await window.waitForTimeout(500);
  // Move cursor down a few lines
  for (let i = 0; i < 3; i++) await window.keyboard.press('ArrowDown');
  await window.waitForTimeout(500);

  const inlineBlame = await window.evaluate(() => {
    const el = document.querySelector('.inline-blame');
    return el ? { text: el.textContent?.trim(), top: el.style.top } : null;
  });
  console.log('Inline blame:', inlineBlame);

  // Move to different line
  for (let i = 0; i < 5; i++) await window.keyboard.press('ArrowDown');
  await window.waitForTimeout(500);
  const inlineBlame2 = await window.evaluate(() => {
    const el = document.querySelector('.inline-blame');
    return el ? { text: el.textContent?.trim(), top: el.style.top } : null;
  });
  console.log('After moving down:', inlineBlame2);
  console.log('Position changed:', inlineBlame?.top !== inlineBlame2?.top);

  // === Test 2: Click blue diff mark → diff hunk popup ===
  console.log('\n=== Test 2: Diff hunk popup ===');
  const diffMark = window.locator('.git-diff-mark').first();
  if (await diffMark.count() > 0) {
    await diffMark.click();
    await window.waitForTimeout(500);

    const popup = await window.evaluate(() => {
      const el = document.querySelector('.diff-hunk-popup');
      if (!el) return null;
      return {
        header: el.querySelector('.hunk-header')?.textContent?.trim(),
        codePreview: el.querySelector('.hunk-code')?.textContent?.substring(0, 80),
        top: el.style.top
      };
    });
    console.log('Diff popup:', popup);

    // Close it
    if (popup) {
      await window.locator('.hunk-close').click();
      await window.waitForTimeout(300);
      const closed = await window.evaluate(() => !document.querySelector('.diff-hunk-popup'));
      console.log('Popup closed:', closed);
    }
  } else {
    console.log('No diff marks found (file might be fully new)');
  }

  await app.close();
  console.log('\n=== Done ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
