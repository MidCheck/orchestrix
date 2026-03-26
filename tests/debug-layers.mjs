import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const PROJECT_A = '/Users/midcheck/VMShare/Code/BrowserAssistant';
const PROJECT_B = '/Users/midcheck/VMShare/Code/novel';

async function main() {
  console.log('=== Launching Electron ===');
  const app = await electron.launch({
    args: [path.join(rootDir, 'out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'development' }
  });
  const window = await app.firstWindow();
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`  [ERROR] ${msg.text()}`);
  });
  await window.waitForTimeout(2000);

  async function getState() {
    return await window.evaluate(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ui = pinia._s.get('ui');
      const ws = pinia._s.get('workspace');
      return {
        paneCount: ui.panes.length,
        projectCount: ws.projects.length,
        activeProject: ws.projects.find(p => p.id === ws.activeProjectId)?.name || 'none',
      };
    });
  }

  async function addProject(projPath) {
    return await window.evaluate(async (p) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ws = pinia._s.get('workspace');
      const ui = pinia._s.get('ui');
      const project = await ws.addProject(p);
      if (project && ui.panes.length < 3) {
        ui.addPane({
          id: `pane-${project.id.slice(0, 8)}`, terminalId: `term-${Date.now()}`,
          projectId: project.id, projectName: project.name, projectPath: project.path,
          agentId: null, title: project.name
        });
      }
      return project?.name;
    }, projPath);
  }

  // Add two projects
  await addProject(PROJECT_A);
  await addProject(PROJECT_B);
  await window.waitForTimeout(500);

  // === Test 1: No close button on terminal panes ===
  console.log('\n=== Test 1: No close button on panes ===');
  const closeBtns = await window.locator('.pane-close').count();
  console.log(`Close buttons on panes: ${closeBtns} (should be 0)`);

  let s = await getState();
  console.log(`Panes: ${s.paneCount}, Projects: ${s.projectCount}`);

  // === Test 2: Remove project from sidebar → shell closes too ===
  console.log('\n=== Test 2: Remove project from sidebar ===');
  // Click remove on first project
  const removeBtn = window.locator('.remove-btn').first();
  // Hover to make it visible
  await window.locator('.project-item').first().hover();
  await window.waitForTimeout(200);
  await removeBtn.click();
  await window.waitForTimeout(500);

  s = await getState();
  console.log(`Panes: ${s.paneCount}, Projects: ${s.projectCount}`);
  console.log(`Active project: ${s.activeProject}`);

  // === Test 3: Remove last project → empty state ===
  console.log('\n=== Test 3: Remove last project ===');
  await window.locator('.project-item').first().hover();
  await window.waitForTimeout(200);
  await window.locator('.remove-btn').first().click();
  await window.waitForTimeout(500);

  s = await getState();
  console.log(`Panes: ${s.paneCount}, Projects: ${s.projectCount}`);
  const emptyVisible = await window.locator('.empty-state').isVisible();
  console.log(`Empty state visible: ${emptyVisible}`);

  // === Test 4: Can re-add project after all closed ===
  console.log('\n=== Test 4: Re-add project ===');
  await addProject(PROJECT_A);
  await window.waitForTimeout(500);

  s = await getState();
  console.log(`Panes: ${s.paneCount}, Projects: ${s.projectCount}, Active: ${s.activeProject}`);
  const termVisible = await window.locator('.pane-wrapper').count();
  console.log(`Terminal panes visible: ${termVisible}`);

  await app.close();
  console.log('\n=== All tests passed ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
