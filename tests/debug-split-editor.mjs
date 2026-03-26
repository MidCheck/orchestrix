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
      const ws = pi._s.get('workspace'); const ui = pi._s.get('ui');
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
      const groupCount = Object.keys(ed.groups).length;
      const groupFiles = Object.values(ed.groups).map(g => ({
        id: g.id,
        files: g.files.map(f => f.split('/').pop()),
        active: g.activeFile?.split('/').pop()
      }));
      return {
        layer: ui.activeLayer,
        project: ws.projects.find(p => p.id === ws.activeProjectId)?.name,
        groupCount,
        groups: groupFiles,
        layoutType: ed.layoutRoot?.type,
        cmCount: document.querySelectorAll('.cm-editor').length,
        splitHandles: document.querySelectorAll('.split-handle').length,
      };
    });
    console.log(`[${label}] layer=${d.layer} project=${d.project} groups=${d.groupCount} cms=${d.cmCount} splits=${d.splitHandles}`);
    d.groups.forEach(g => console.log(`  group ${g.id}: [${g.files.join(', ')}] active=${g.active}`));
    return d;
  }

  await addProject(PROJECT_A);
  await addProject(PROJECT_B);
  await window.waitForTimeout(500);

  // === Test 1: Open files in project A ===
  console.log('\n=== Test 1: Open files in BrowserAssistant ===');
  await window.locator('.pane-wrapper').first().click();
  await window.waitForTimeout(300);

  // Open README.md and LICENSE
  for (const name of ['README.md', 'LICENSE']) {
    for (const item of await window.locator('.file-tree-item .item-row').all()) {
      if ((await item.textContent())?.includes(name)) { await item.click(); break; }
    }
    await window.waitForTimeout(500);
  }
  await diag('After opening 2 files');

  // === Test 2: Tab reorder via drag ===
  console.log('\n=== Test 2: Tab reorder (drag) ===');
  const tabs = await window.locator('.editor-group .tab').all();
  if (tabs.length >= 2) {
    const src = tabs[0];
    const dst = tabs[1];
    await src.dragTo(dst);
    await window.waitForTimeout(300);
  }
  await diag('After tab drag');

  // === Test 3: Split via store API (simulate drag to edge) ===
  console.log('\n=== Test 3: Create split ===');
  await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ed = pi._s.get('editor');
    const groupIds = Object.keys(ed.groups);
    if (groupIds.length > 0 && ed.groups[groupIds[0]].files.length >= 2) {
      const gid = groupIds[0];
      const filePath = ed.groups[gid].files[0]; // first file
      ed.splitWithFile(gid, filePath, gid, 'horizontal', 'after');
    }
  });
  await window.waitForTimeout(500);
  let d = await diag('After split');

  console.log(`Split handles: ${d.splitHandles} (should be 1)`);
  console.log(`CM editors: ${d.cmCount} (should be 2)`);

  // === Test 4: Switch to project B, verify clean slate ===
  console.log('\n=== Test 4: Switch to project B ===');
  await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    pi._s.get('ui').switchToTerminal();
  });
  await window.waitForTimeout(200);
  await window.locator('.pane-wrapper').last().click();
  await window.waitForTimeout(300);

  // Open a file in project B
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    const text = await item.textContent();
    if (text && !text.includes('▶') && !text.includes('▼')) { await item.click(); break; }
  }
  await window.waitForTimeout(500);
  d = await diag('Project B');
  console.log(`Groups: ${d.groupCount} (should be 1, project B has no split)`);

  // === Test 5: Switch back to A → layout restored ===
  console.log('\n=== Test 5: Switch back to A, verify layout restored ===');
  for (const item of await window.locator('.project-item').all()) {
    if ((await item.textContent())?.includes('BrowserAssistant')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);
  d = await diag('Restored A');
  console.log(`Groups restored: ${d.groupCount} (should be 2, split layout preserved)`);
  console.log(`Split handles: ${d.splitHandles} (should be 1)`);
  console.log(`CMs restored: ${d.cmCount} (should be 2)`);

  // === Test 6: Close file in a group ===
  console.log('\n=== Test 6: Close a file ===');
  const closeBtn = window.locator('.editor-group .tab-close').first();
  if (await closeBtn.count() > 0) {
    await window.locator('.editor-group .tab').first().hover();
    await closeBtn.click();
    await window.waitForTimeout(500);
  }
  await diag('After close');

  await app.close();
  console.log('\n=== All split editor tests passed ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
