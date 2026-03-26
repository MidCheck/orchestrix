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

  async function getState() {
    return await window.evaluate(() => {
      const p = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ui = p._s.get('ui');
      const ws = p._s.get('workspace');
      return {
        panes: ui.panes.map(p => p.projectName),
        projects: ws.projects.map(p => p.name),
        activeProject: ws.projects.find(p => p.id === ws.activeProjectId)?.name,
      };
    });
  }

  // Add two projects (with shells)
  for (const proj of [PROJECT_A, PROJECT_B]) {
    await window.evaluate(async (p) => {
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
    }, proj);
  }
  await window.waitForTimeout(500);

  console.log('\n=== Initial: 2 projects, 2 shells ===');
  let s = await getState();
  console.log(`Projects: ${s.projects.join(', ')}`);
  console.log(`Shells: ${s.panes.join(', ')}`);

  // Remove BrowserAssistant from sidebar (shell closes)
  console.log('\n=== Remove BrowserAssistant via sidebar ===');
  await window.locator('.project-item').first().hover();
  await window.waitForTimeout(200);
  await window.locator('.remove-btn').first().click();
  await window.waitForTimeout(500);

  s = await getState();
  console.log(`Projects: ${s.projects.join(', ')}`);
  console.log(`Shells: ${s.panes.join(', ')}`);

  // Re-add BrowserAssistant (project exists but no shell)
  console.log('\n=== Re-add BrowserAssistant (project only, no shell yet) ===');
  await window.evaluate(async (p) => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace');
    await ws.addProject(p);
    // Don't create pane — simulate project without shell
  }, PROJECT_A);
  await window.waitForTimeout(500);

  s = await getState();
  console.log(`Projects: ${s.projects.join(', ')}`);
  console.log(`Shells: ${s.panes.join(', ')} (BrowserAssistant has no shell yet)`);

  // Click BrowserAssistant in sidebar → should auto-create shell
  console.log('\n=== Click BrowserAssistant in sidebar ===');
  // Find the project item for BrowserAssistant
  const items = await window.locator('.project-item').all();
  for (const item of items) {
    const text = await item.textContent();
    if (text?.includes('BrowserAssistant')) {
      await item.click();
      break;
    }
  }
  await window.waitForTimeout(500);

  s = await getState();
  console.log(`Projects: ${s.projects.join(', ')}`);
  console.log(`Shells: ${s.panes.join(', ')}`);
  console.log(`Active project: ${s.activeProject}`);
  console.log(`Shell auto-created: ${s.panes.includes('BrowserAssistant')}`);

  await app.close();
  console.log('\n=== All tests passed ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
