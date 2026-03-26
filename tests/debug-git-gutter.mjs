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

  // === Blue diff marks ===
  console.log('\n=== Blue diff marks ===');
  const marks = await window.evaluate(() => document.querySelectorAll('.git-diff-mark').length);
  console.log(`Blue diff marks: ${marks}`);

  // === Click gutter to show blame ===
  console.log('\n=== Click gutter ===');

  // Use mouse.click directly on the gutter area
  const gutterBox = await window.locator('.cm-gutters').boundingBox();
  if (gutterBox) {
    // Click at different y positions to find a line
    for (const yOffset of [40, 60, 80, 100]) {
      await window.mouse.click(gutterBox.x + 15, gutterBox.y + yOffset);
      await window.waitForTimeout(300);

      const tooltip = await window.evaluate(() => {
        const tt = document.querySelector('.blame-tooltip');
        if (!tt) return null;
        return {
          author: tt.querySelector('.blame-author')?.textContent,
          summary: tt.querySelector('.blame-summary')?.textContent,
          hash: tt.querySelector('.blame-hash')?.textContent,
          top: tt.style.top
        };
      });

      if (tooltip) {
        console.log(`✅ Blame tooltip at yOffset=${yOffset}:`);
        console.log(`  Author: ${tooltip.author}`);
        console.log(`  Summary: ${tooltip.summary}`);
        console.log(`  Hash: ${tooltip.hash}`);
        console.log(`  Position: top=${tooltip.top}`);
        break;
      } else {
        console.log(`  yOffset=${yOffset}: no tooltip`);
      }
    }

    // Check if event reaches editor-body
    const debugClick = await window.evaluate(() => {
      return new Promise((resolve) => {
        const body = document.querySelector('.editor-body');
        if (!body) { resolve({ error: 'no editor-body' }); return; }

        const handler = (e) => {
          const target = e.target;
          const inGutter = !!target.closest('.cm-gutters');
          body.removeEventListener('click', handler);
          resolve({ fired: true, inGutter, targetClass: target.className });
        };
        body.addEventListener('click', handler);

        // Trigger click on gutter
        const gutter = document.querySelector('.cm-gutters');
        if (gutter) {
          gutter.click();
        }
      });
    });
    console.log('\nClick event debug:', JSON.stringify(debugClick));
  }

  await app.close();
  console.log('\n=== Done ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
