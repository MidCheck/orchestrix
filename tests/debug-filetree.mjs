import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function main() {
  console.log('=== Launching Electron ===');

  const app = await electron.launch({
    args: [path.join(rootDir, 'out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'development' }
  });

  const window = await app.firstWindow();

  // Collect console logs
  window.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[FileTree]') || text.includes('Error') || text.includes('error')) {
      console.log(`  CONSOLE [${msg.type()}]: ${text}`);
    }
  });

  await window.waitForTimeout(2000);

  // === Step 1: Check initial state ===
  console.log('\n=== Step 1: Initial State ===');
  const paneCount1 = await window.locator('.pane-wrapper').count();
  const fileTreeText1 = await window.locator('.file-tree').textContent();
  console.log(`Panes: ${paneCount1}, FileTree: "${fileTreeText1.trim()}"`);

  // === Step 2: Add project 1 via store (simulate Sidebar click) ===
  console.log('\n=== Step 2: Add Project 1 (orchestrix root) ===');
  await window.evaluate(async (projPath) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    // Get the workspace store instance
    const wsStore = pinia._s.get('workspace');
    const uiStore = pinia._s.get('ui');

    // Call addProject which triggers IPC + updates store
    const project = await wsStore.addProject(projPath);
    console.log('[TEST] addProject result:', JSON.stringify(project));

    // Also create a pane for it (like Sidebar does)
    if (project && uiStore.panes.length < 3) {
      uiStore.addPane({
        id: `pane-p1`,
        terminalId: `term-p1`,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agentId: null,
        title: project.name
      });
    }
  }, rootDir);

  await window.waitForTimeout(1500);

  const storeAfterAdd1 = await window.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pinia._s.get('workspace');
    return {
      projects: ws.projects.map(p => ({ id: p.id, name: p.name })),
      activeProjectId: ws.activeProjectId
    };
  });
  console.log('Store after add 1:', JSON.stringify(storeAfterAdd1));

  const fileTreeText2 = await window.locator('.file-tree').textContent();
  console.log(`FileTree: "${fileTreeText2.trim().substring(0, 100)}..."`);

  const projectItems1 = await window.locator('.project-item').count();
  console.log(`Project items in sidebar: ${projectItems1}`);

  // === Step 3: Add project 2 (docs dir) ===
  console.log('\n=== Step 3: Add Project 2 (src dir) ===');
  await window.evaluate(async (projPath) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const wsStore = pinia._s.get('workspace');
    const uiStore = pinia._s.get('ui');

    const project = await wsStore.addProject(projPath);
    console.log('[TEST] addProject result:', JSON.stringify(project));

    if (project && uiStore.panes.length < 3) {
      uiStore.addPane({
        id: `pane-p2`,
        terminalId: `term-p2`,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        agentId: null,
        title: project.name
      });
    }
  }, path.join(rootDir, 'src'));

  await window.waitForTimeout(1500);

  const storeAfterAdd2 = await window.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pinia._s.get('workspace');
    return {
      projects: ws.projects.map(p => ({ id: p.id, name: p.name })),
      activeProjectId: ws.activeProjectId
    };
  });
  console.log('Store after add 2:', JSON.stringify(storeAfterAdd2));

  const fileTreeText3 = await window.locator('.file-tree').textContent();
  console.log(`FileTree (should show src contents): "${fileTreeText3.trim().substring(0, 150)}"`);

  // === Step 4: Switch back to project 1 by clicking ===
  console.log('\n=== Step 4: Click project 1 in sidebar ===');
  const firstProject = window.locator('.project-item').first();
  await firstProject.click();
  await window.waitForTimeout(1000);

  const storeAfterSwitch = await window.evaluate(() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pinia._s.get('workspace');
    const ui = pinia._s.get('ui');
    return {
      activeProjectId: ws.activeProjectId,
      activePaneId: ui.activePaneId
    };
  });
  console.log('Store after switch:', JSON.stringify(storeAfterSwitch));

  const fileTreeText4 = await window.locator('.file-tree').textContent();
  console.log(`FileTree (should show root contents): "${fileTreeText4.trim().substring(0, 150)}"`);

  // === Step 5: Click pane-p2 terminal to switch ===
  console.log('\n=== Step 5: Click second terminal pane ===');
  const secondPane = window.locator('.pane-wrapper').nth(2); // 0=Shell1, 1=p1, 2=p2
  if (await secondPane.count() > 0) {
    await secondPane.click();
    await window.waitForTimeout(1000);

    const storeAfterPaneSwitch = await window.evaluate(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ws = pinia._s.get('workspace');
      const ui = pinia._s.get('ui');
      return {
        activeProjectId: ws.activeProjectId,
        activePaneId: ui.activePaneId,
        activePaneProjectId: ui.panes.find(p => p.id === ui.activePaneId)?.projectId
      };
    });
    console.log('Store after pane switch:', JSON.stringify(storeAfterPaneSwitch));

    const fileTreeText5 = await window.locator('.file-tree').textContent();
    console.log(`FileTree (should show src contents): "${fileTreeText5.trim().substring(0, 150)}"`);
  } else {
    console.log('Second pane not found, pane count:', await window.locator('.pane-wrapper').count());
  }

  await app.close();
  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
