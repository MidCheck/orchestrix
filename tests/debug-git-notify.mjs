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
  const errors = [];
  window.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error') { errors.push(t); console.log(`  [ERROR] ${t}`); }
  });
  await window.waitForTimeout(2000);

  // Add orchestrix as git project
  await window.evaluate(async (p) => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace'); const ui = pi._s.get('ui');
    const project = await ws.addProject(p);
    if (project) ui.addPane({ id: 'p1', terminalId: 'term-1', projectId: project.id, projectName: project.name, projectPath: project.path, agentId: null, title: project.name });
  }, rootDir);
  await window.waitForTimeout(2000);

  // === Debug 1: Git Status badges ===
  console.log('\n=== Git Status Debug ===');

  const gitDebug = await window.evaluate(async () => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace');
    const project = ws.activeProject;

    // Check API works
    const isGit = await window.electronAPI.workspace.isGitRepo(project.path);
    const status = await window.electronAPI.workspace.gitStatus(project.path);

    // Check what FileTreeItems see
    const items = document.querySelectorAll('.file-tree-item .item-row');
    const itemDetails = [];
    for (const item of Array.from(items).slice(0, 10)) {
      const name = item.querySelector('.name')?.textContent?.trim();
      const badge = item.querySelector('.git-badge')?.textContent?.trim();
      const style = item.getAttribute('style');
      itemDetails.push({ name, badge: badge || null, style });
    }

    return { isGit, statusKeys: Object.keys(status).slice(0, 5), statusCount: Object.keys(status).length, itemDetails };
  });

  console.log('isGit:', gitDebug.isGit);
  console.log('Status count:', gitDebug.statusCount);
  console.log('Status keys:', gitDebug.statusKeys);
  console.log('File tree items:');
  gitDebug.itemDetails.forEach(d => console.log(`  ${d.name}: badge=${d.badge}`));

  // === Debug 2: Git Diff ===
  console.log('\n=== Git Diff Debug ===');

  // Open .gitignore (definitely modified)
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    const text = await item.textContent();
    if (text?.includes('.gitignore')) {
      // .gitignore starts with dot, might be hidden
    }
    if (text?.includes('README.md')) { await item.click(); break; }
  }
  await window.waitForTimeout(1000);

  // Check file opened
  const fileOpened = await window.evaluate(() => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ed = pi._s.get('editor');
    return { activeFile: ed.activeFile?.name, content: ed.activeFile?.content?.substring(0, 50) };
  });
  console.log('Opened file:', fileOpened);

  // Click diff
  const diffBtn = window.locator('.diff-btn');
  if (await diffBtn.count() > 0) {
    await diffBtn.click();
    await window.waitForTimeout(1500);

    const diffDebug = await window.evaluate(async () => {
      const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
      const ws = pi._s.get('workspace');
      const ed = pi._s.get('editor');
      const project = ws.activeProject;
      const filePath = ed.activeFile?.path;

      // What does gitShow return?
      let headContent = '';
      if (project && filePath) {
        headContent = await window.electronAPI.workspace.gitShow(project.path, filePath);
      }

      const mergeView = document.querySelector('.cm-mergeView');
      const mergeEditors = document.querySelectorAll('.cm-mergeView .cm-editor');

      return {
        headContentLength: headContent.length,
        headContentPreview: headContent.substring(0, 80),
        mergeViewExists: !!mergeView,
        mergeEditorCount: mergeEditors.length,
        mergeViewHTML: mergeView?.innerHTML?.substring(0, 200) || 'N/A'
      };
    });

    console.log('HEAD content length:', diffDebug.headContentLength);
    console.log('HEAD content preview:', diffDebug.headContentPreview);
    console.log('MergeView exists:', diffDebug.mergeViewExists);
    console.log('Merge editors:', diffDebug.mergeEditorCount);

    // Exit diff
    await diffBtn.click();
    await window.waitForTimeout(500);
  }

  // === Debug 3: Terminal Notification ===
  console.log('\n=== Terminal Notification Debug ===');

  // Check notification patterns
  const notifyDebug = await window.evaluate(() => {
    // Check if terminal output has any bell chars or prompts
    return {
      hasNotifyApi: typeof window.electronAPI.terminal.onNotify === 'function',
      notifyBarExists: !!document.querySelector('.notify-bar'),
      paneHeaders: Array.from(document.querySelectorAll('.pane-header')).map(h => h.textContent?.trim())
    };
  });
  console.log('Notify API:', notifyDebug.hasNotifyApi);
  console.log('Pane headers:', notifyDebug.paneHeaders);

  // Try sending a command in the terminal and waiting for completion
  console.log('\nSending "echo hello" to terminal...');
  await window.evaluate(() => {
    window.electronAPI.terminal.write('term-1', 'echo hello\\n');
  });
  await window.waitForTimeout(2000);

  // Check if any notification appeared (probably not since window is focused)
  console.log('Note: notifications only appear when window is NOT focused');
  console.log('Testing with bell character...');
  await window.evaluate(() => {
    // Send bell character
    window.electronAPI.terminal.write('term-1', 'printf "\\a"\\n');
  });
  await window.waitForTimeout(1000);

  // Report errors
  if (errors.length > 0) {
    console.log('\n=== Errors ===');
    errors.forEach(e => console.log(e.substring(0, 200)));
  }

  await app.close();
  console.log('\n=== Done ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
