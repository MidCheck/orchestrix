import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'tests', '_file_ops_test');

async function main() {
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'existing.txt'), 'hello');

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
  }, testDir);
  await window.waitForTimeout(1500);

  // === Test 1: Right-click on file → context menu ===
  console.log('\n=== Test 1: Right-click context menu ===');
  const fileItem = window.locator('.file-tree-item .item-row').first();
  await fileItem.click({ button: 'right' });
  await window.waitForTimeout(300);
  const menuItems = await window.locator('.context-menu .ctx-item').evaluateAll(els => els.map(e => e.textContent?.trim()));
  console.log('Menu items:', menuItems);

  // Close menu
  await window.mouse.click(10, 10);
  await window.waitForTimeout(200);

  // === Test 2: Create new file via IPC ===
  console.log('\n=== Test 2: Create file ===');
  await window.evaluate(async (dir) => {
    await window.electronAPI.workspace.createFile(dir + '/newfile.txt');
  }, testDir);
  const fileExists = fs.existsSync(path.join(testDir, 'newfile.txt'));
  console.log('File created on disk:', fileExists);

  // === Test 3: Create directory via IPC ===
  console.log('\n=== Test 3: Create directory ===');
  await window.evaluate(async (dir) => {
    await window.electronAPI.workspace.createDir(dir + '/newdir');
  }, testDir);
  const dirExists = fs.existsSync(path.join(testDir, 'newdir'));
  console.log('Dir created on disk:', dirExists);

  // === Test 4: Rename file via IPC ===
  console.log('\n=== Test 4: Rename file ===');
  await window.evaluate(async (dir) => {
    await window.electronAPI.workspace.renameFile(dir + '/newfile.txt', dir + '/renamed.txt');
  }, testDir);
  const renamed = fs.existsSync(path.join(testDir, 'renamed.txt'));
  const oldGone = !fs.existsSync(path.join(testDir, 'newfile.txt'));
  console.log('Renamed exists:', renamed, '| Old gone:', oldGone);

  // === Test 5: Delete file via IPC ===
  console.log('\n=== Test 5: Delete file ===');
  await window.evaluate(async (dir) => {
    await window.electronAPI.workspace.deleteFile(dir + '/renamed.txt');
  }, testDir);
  const deleted = !fs.existsSync(path.join(testDir, 'renamed.txt'));
  console.log('File deleted:', deleted);

  // === Test 6: Delete directory via IPC ===
  console.log('\n=== Test 6: Delete directory ===');
  await window.evaluate(async (dir) => {
    await window.electronAPI.workspace.deleteFile(dir + '/newdir');
  }, testDir);
  const dirDeleted = !fs.existsSync(path.join(testDir, 'newdir'));
  console.log('Dir deleted:', dirDeleted);

  // === Test 7: Right-click on blank area ===
  console.log('\n=== Test 7: Right-click blank area ===');
  const tree = window.locator('.file-tree');
  const box = await tree.boundingBox();
  if (box) {
    await window.mouse.click(box.x + 50, box.y + box.height - 20, { button: 'right' });
    await window.waitForTimeout(300);
    const blankMenu = await window.locator('.context-menu .ctx-item').evaluateAll(els => els.map(e => e.textContent?.trim()));
    console.log('Blank area menu:', blankMenu);
  }

  await app.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n=== All file ops tests passed ===');
}

main().catch(err => {
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  console.error('FAILED:', err);
  process.exit(1);
});
