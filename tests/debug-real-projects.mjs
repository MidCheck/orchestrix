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
    const t = msg.text();
    if (t.includes('[FileTree]') || t.includes('[TEST]') || msg.type() === 'error') {
      console.log(`  [${msg.type()}] ${t}`);
    }
  });
  await window.waitForTimeout(2000);

  // Helper: add project + create pane
  async function addProject(projPath) {
    return await window.evaluate(async (p) => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ws = pinia._s.get('workspace');
      const ui = pinia._s.get('ui');
      const project = await ws.addProject(p);
      if (project && ui.panes.length < 3) {
        ui.addPane({
          id: `pane-${project.id.slice(0, 8)}`,
          terminalId: `term-${Date.now()}`,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          agentId: null,
          title: project.name
        });
      }
      return project ? { id: project.id, name: project.name, path: project.path } : null;
    }, projPath);
  }

  // Helper: get current state
  async function getState() {
    return await window.evaluate(() => {
      const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ws = pinia._s.get('workspace');
      const ui = pinia._s.get('ui');
      return {
        activeProject: ws.activeProjectId,
        activePaneId: ui.activePaneId,
        fileTreeText: document.querySelector('.file-tree')?.textContent?.trim().substring(0, 100)
      };
    });
  }

  // Add project A
  console.log('\n=== Add Project A: BrowserAssistant ===');
  const pA = await addProject(PROJECT_A);
  console.log('Added:', pA?.name);
  await window.waitForTimeout(1000);
  let state = await getState();
  console.log('FileTree:', state.fileTreeText);

  // Add project B
  console.log('\n=== Add Project B: novel ===');
  const pB = await addProject(PROJECT_B);
  console.log('Added:', pB?.name);
  await window.waitForTimeout(1000);
  state = await getState();
  console.log('FileTree:', state.fileTreeText);

  // Switch to project A via sidebar
  console.log('\n=== Click Project A in sidebar ===');
  await window.locator('.project-item').first().click();
  await window.waitForTimeout(1000);
  state = await getState();
  console.log('Active:', state.activeProject === pA?.id ? 'ProjectA' : 'ProjectB');
  console.log('FileTree:', state.fileTreeText);

  // Switch to project B's terminal pane
  console.log('\n=== Click Project B terminal pane ===');
  const panes = await window.locator('.pane-wrapper').count();
  console.log('Total panes:', panes);
  // Last pane should be project B
  await window.locator('.pane-wrapper').last().click();
  await window.waitForTimeout(1000);
  state = await getState();
  console.log('Active:', state.activeProject === pB?.id ? 'ProjectB' : 'ProjectA');
  console.log('FileTree:', state.fileTreeText);

  // Toggle back and forth quickly
  console.log('\n=== Rapid switching ===');
  for (let i = 0; i < 3; i++) {
    await window.locator('.project-item').first().click();
    await window.waitForTimeout(500);
    state = await getState();
    console.log(`Switch ${i * 2 + 1} -> ProjectA: ${state.fileTreeText?.substring(0, 50)}`);

    await window.locator('.project-item').last().click();
    await window.waitForTimeout(500);
    state = await getState();
    console.log(`Switch ${i * 2 + 2} -> ProjectB: ${state.fileTreeText?.substring(0, 50)}`);
  }

  await app.close();
  console.log('\n=== All tests passed ===');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
