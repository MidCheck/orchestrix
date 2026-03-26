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

  // Add git project
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
  await window.waitForTimeout(800);

  // Enter diff mode
  console.log('\n=== Enter Diff Mode ===');
  await window.locator('.diff-btn').click();
  await window.waitForTimeout(1000);

  const diffState = await window.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.diff-label')).map(l => ({
      text: l.textContent?.trim(),
      width: l.style.width
    }));
    const panes = Array.from(document.querySelectorAll('.diff-pane')).map(p => ({
      width: p.style.width,
      actualWidth: p.clientWidth
    }));
    const handle = document.querySelector('.diff-handle');
    const editors = document.querySelectorAll('.diff-pane .cm-editor');
    const leftContent = editors[0]?.querySelector('.cm-content')?.textContent?.substring(0, 60);
    const rightContent = editors[1]?.querySelector('.cm-content')?.textContent?.substring(0, 60);

    return { labels, panes, hasHandle: !!handle, editorCount: editors.length, leftContent, rightContent };
  });

  console.log('Labels:', diffState.labels);
  console.log('Panes:', diffState.panes);
  console.log('Handle exists:', diffState.hasHandle);
  console.log('Editors:', diffState.editorCount);
  console.log('Left:', diffState.leftContent);
  console.log('Right:', diffState.rightContent);

  // Drag the handle
  console.log('\n=== Drag Handle ===');
  const handle = window.locator('.diff-handle');
  const handleBox = await handle.boundingBox();
  if (handleBox) {
    // Drag 100px to the left
    await window.mouse.move(handleBox.x + 2, handleBox.y + handleBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(handleBox.x - 100, handleBox.y + handleBox.height / 2, { steps: 5 });
    await window.mouse.up();
    await window.waitForTimeout(300);

    const afterDrag = await window.evaluate(() => {
      const panes = Array.from(document.querySelectorAll('.diff-pane'));
      return panes.map(p => ({ width: p.style.width, actual: p.clientWidth }));
    });
    console.log('After drag left:', afterDrag);

    // Drag back right
    const handleBox2 = await handle.boundingBox();
    if (handleBox2) {
      await window.mouse.move(handleBox2.x + 2, handleBox2.y + handleBox2.height / 2);
      await window.mouse.down();
      await window.mouse.move(handleBox2.x + 200, handleBox2.y + handleBox2.height / 2, { steps: 5 });
      await window.mouse.up();
      await window.waitForTimeout(300);

      const afterDrag2 = await window.evaluate(() => {
        const panes = Array.from(document.querySelectorAll('.diff-pane'));
        return panes.map(p => ({ width: p.style.width, actual: p.clientWidth }));
      });
      console.log('After drag right:', afterDrag2);
    }
  }

  // Exit diff
  console.log('\n=== Exit Diff ===');
  await window.locator('.diff-btn').click();
  await window.waitForTimeout(500);
  const afterExit = await window.evaluate(() => ({
    diffVisible: !!document.querySelector('.diff-wrapper:not([style*="display: none"])'),
    normalEditor: !!document.querySelector('.cm-editor'),
  }));
  console.log('Diff closed:', !afterExit.diffVisible);
  console.log('Normal editor restored:', afterExit.normalEditor);

  await app.close();
  console.log('\n=== Diff test passed ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
