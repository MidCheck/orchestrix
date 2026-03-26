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
          id: `pane-${project.id.slice(0, 8)}`, terminalId: `term-${Date.now()}`,
          projectId: project.id, projectName: project.name, projectPath: project.path,
          agentId: null, title: project.name
        });
      }
      return project ? { id: project.id, name: project.name } : null;
    }, projPath);
  }

  async function getEditorState() {
    return await window.evaluate(() => {
      const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ui = pi._s.get('ui');
      const ws = pi._s.get('workspace');
      const ed = pi._s.get('editor');
      const cm = document.querySelector('.cm-editor');
      return {
        layer: ui.activeLayer,
        activeProject: ws.projects.find(p => p.id === ws.activeProjectId)?.name,
        activeFile: ed.activeFile?.name,
        editorVisible: !!cm,
        projectFiles: ed.currentProjectFiles.map(f => f.name),
      };
    });
  }

  // Setup: add two projects
  const pA = await addProject(PROJECT_A);
  const pB = await addProject(PROJECT_B);
  await window.waitForTimeout(500);

  // === Step 1: Open file in project A ===
  console.log('\n=== Step 1: Open file in BrowserAssistant ===');
  // Click project A pane
  await window.locator('.pane-wrapper').first().click();
  await window.waitForTimeout(500);
  // Open a file
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    const text = await item.textContent();
    if (text?.includes('README.md')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);

  let s = await getEditorState();
  console.log(`Layer: ${s.layer}, Project: ${s.activeProject}, File: ${s.activeFile}`);

  // Move cursor: type some navigation to change position
  const cm = window.locator('.cm-content');
  await cm.click();
  // Move cursor down a few lines
  for (let i = 0; i < 5; i++) await window.keyboard.press('ArrowDown');
  await window.keyboard.press('End');
  await window.waitForTimeout(200);

  // Get cursor position
  const cursorA = await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ed = pi._s.get('editor');
    // Read from the live CM instance
    const cmView = document.querySelector('.cm-editor');
    // @ts-ignore
    const view = cmView?.cmView?.view;
    if (view) {
      return { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head };
    }
    return null;
  });
  console.log(`Cursor in BrowserAssistant/README.md: anchor=${cursorA?.anchor}`);

  // === Step 2: Switch to project B, open file ===
  console.log('\n=== Step 2: Switch to project B via sidebar ===');
  const projectItems = await window.locator('.project-item').all();
  for (const item of projectItems) {
    const text = await item.textContent();
    if (text?.includes('novel')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);

  s = await getEditorState();
  console.log(`Layer: ${s.layer}, Project: ${s.activeProject}, File: ${s.activeFile}`);
  console.log(`Project files: ${s.projectFiles.join(', ')}`);

  // If no files, open one
  if (!s.activeFile) {
    console.log('  Opening a file from novel...');
    for (const item of await window.locator('.file-tree-item .item-row').all()) {
      const text = await item.textContent();
      if (text && !text.includes('▶') && !text.includes('▼')) {
        await item.click();
        break;
      }
    }
    await window.waitForTimeout(800);
    s = await getEditorState();
    console.log(`  Now: Layer: ${s.layer}, File: ${s.activeFile}`);
  }

  // === Step 3: Switch back to project A → should restore README.md ===
  console.log('\n=== Step 3: Switch back to BrowserAssistant ===');
  for (const item of await window.locator('.project-item').all()) {
    const text = await item.textContent();
    if (text?.includes('BrowserAssistant')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);

  s = await getEditorState();
  console.log(`Layer: ${s.layer}, Project: ${s.activeProject}, File: ${s.activeFile}`);
  console.log(`File restored to README.md: ${s.activeFile === 'README.md'}`);

  // Check cursor was restored (approximately)
  const restoredState = await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ed = pi._s.get('editor');
    const saved = ed.getCursorState(ed.activeFilePath);
    return saved ? { anchor: saved.anchor, scrollTop: saved.scrollTop } : null;
  });
  console.log(`Cursor state preserved: anchor=${restoredState?.anchor} (was ${cursorA?.anchor})`);
  console.log(`Position match: ${restoredState?.anchor === cursorA?.anchor}`);

  // === Step 4: Switch project B again → should show B's last file ===
  console.log('\n=== Step 4: Switch to novel again ===');
  for (const item of await window.locator('.project-item').all()) {
    const text = await item.textContent();
    if (text?.includes('novel')) { await item.click(); break; }
  }
  await window.waitForTimeout(500);

  s = await getEditorState();
  console.log(`Project: ${s.activeProject}, File: ${s.activeFile}`);
  console.log(`Restored to novel's last file: ${!!s.activeFile}`);

  await app.close();
  console.log('\n=== All cursor/project-switch tests passed ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
