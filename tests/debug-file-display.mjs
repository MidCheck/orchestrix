import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const PROJECT_A = '/Users/midcheck/VMShare/Code/BrowserAssistant';
const PROJECT_B = '/Users/midcheck/VMShare/Code/novel';

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

  async function addProject(projPath) {
    return await window.evaluate(async (p) => {
      const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ws = pi._s.get('workspace');
      const ui = pi._s.get('ui');
      const project = await ws.addProject(p);
      if (project && ui.panes.length < 3) {
        ui.addPane({
          id: `pane-${project.id.slice(0,8)}`, terminalId: `term-${Date.now()}`,
          projectId: project.id, projectName: project.name, projectPath: project.path,
          agentId: null, title: project.name
        });
      }
      return project;
    }, projPath);
  }

  async function diag(label) {
    const d = await window.evaluate(() => {
      const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ui = pi._s.get('ui'); const ed = pi._s.get('editor'); const ws = pi._s.get('workspace');
      return {
        layer: ui.activeLayer,
        project: ws.projects.find(p => p.id === ws.activeProjectId)?.name,
        activeFile: ed.activeFile?.name || null,
        currentProjectFiles: ed.currentProjectFiles.map(f => f.name),
        hasCm: !!document.querySelector('.cm-editor'),
        cmContent: document.querySelector('.cm-content')?.textContent?.substring(0, 40) || null,
        editorLayerVisible: !!(document.querySelector('.editor-layer')?.offsetHeight),
      };
    });
    console.log(`[${label}] layer=${d.layer} project=${d.project} file=${d.activeFile} files=[${d.currentProjectFiles}] cm=${d.hasCm} visible=${d.editorLayerVisible}`);
    if (d.cmContent) console.log(`  content: "${d.cmContent}"`);
    return d;
  }

  await addProject(PROJECT_A);
  await addProject(PROJECT_B);
  await window.waitForTimeout(500);

  // === Scenario: Open files in both projects, then switch while in editor layer ===

  // 1. Open file in project A
  console.log('\n=== Open README.md in BrowserAssistant ===');
  await window.locator('.pane-wrapper').first().click();
  await window.waitForTimeout(300);
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('README.md')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);
  await diag('After open A/README');

  // 2. Switch to terminal, click project B pane
  console.log('\n=== Switch to terminal, select project B ===');
  await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    pi._s.get('ui').switchToTerminal();
  });
  await window.waitForTimeout(300);
  await window.locator('.pane-wrapper').last().click();
  await window.waitForTimeout(300);

  // 3. Open file in project B
  console.log('\n=== Open file in novel ===');
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    const text = await item.textContent();
    if (text && !text.includes('▶') && !text.includes('▼')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);
  await diag('After open B/file');

  // 4. NOW the key test: while in editor layer showing B's file,
  //    click project A in sidebar
  console.log('\n=== KEY TEST: Click project A in sidebar while in editor layer ===');
  for (const item of await window.locator('.project-item').all()) {
    if ((await item.textContent())?.includes('BrowserAssistant')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);
  let d = await diag('After sidebar click A');

  // 5. Click project B again in sidebar
  console.log('\n=== Click project B in sidebar ===');
  for (const item of await window.locator('.project-item').all()) {
    if ((await item.textContent())?.includes('novel')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);
  d = await diag('After sidebar click B');

  // 6. Now open ANOTHER file in project A, switch back
  console.log('\n=== Open LICENSE in BrowserAssistant ===');
  for (const item of await window.locator('.project-item').all()) {
    if ((await item.textContent())?.includes('BrowserAssistant')) { await item.click(); break; }
  }
  await window.waitForTimeout(500);
  // If we're in terminal layer now, open a file
  const layerNow = await window.evaluate(() => {
    return document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui').activeLayer;
  });
  console.log(`  Current layer: ${layerNow}`);

  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('LICENSE')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);
  await diag('After open A/LICENSE');

  // Switch to B
  for (const item of await window.locator('.project-item').all()) {
    if ((await item.textContent())?.includes('novel')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);
  d = await diag('Switch to B from editor');

  // Switch back to A - should show LICENSE (the last opened)
  for (const item of await window.locator('.project-item').all()) {
    if ((await item.textContent())?.includes('BrowserAssistant')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);
  d = await diag('Switch back to A');
  console.log(`\nLast file restored correctly: ${d.activeFile === 'LICENSE'}`);

  await app.close();
  console.log('\n=== Done ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
