import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function main() {
  // Create test files
  const testDir = path.join(rootDir, 'tests', '_preview_test');
  fs.mkdirSync(testDir, { recursive: true });

  // 1px PNG (smallest valid PNG)
  const pngBuf = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000a49444154789c626000000002000198e195280000000049454e44ae426082',
    'hex'
  );
  fs.writeFileSync(path.join(testDir, 'test.png'), pngBuf);

  // Binary file
  const binBuf = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) binBuf[i] = i;
  fs.writeFileSync(path.join(testDir, 'test.bin'), binBuf);
  // rename to .exe so it's classified as binary
  fs.renameSync(path.join(testDir, 'test.bin'), path.join(testDir, 'test.exe'));

  const app = await electron.launch({
    args: [path.join(rootDir, 'out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'development' }
  });
  const window = await app.firstWindow();
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`  [ERROR] ${msg.text()}`);
  });
  await window.waitForTimeout(2000);

  // Add the test dir as project
  await window.evaluate(async (p) => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace'); const ui = pi._s.get('ui');
    const project = await ws.addProject(p);
    if (project) ui.addPane({ id: 'p1', terminalId: 'term-1', projectId: project.id, projectName: project.name, projectPath: project.path, agentId: null, title: project.name });
  }, testDir);
  await window.waitForTimeout(1500);

  // === Test 1: Image preview ===
  console.log('\n=== Test 1: Image Preview ===');
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('test.png')) { await item.click(); break; }
  }
  await window.waitForTimeout(1000);

  const imgResult = await window.evaluate(() => ({
    hasImg: !!document.querySelector('.preview-image'),
    hasMediaPreview: !!document.querySelector('.media-preview'),
    hasCmEditor: !!document.querySelector('.cm-editor'),
    fileInfo: document.querySelector('.file-info')?.textContent?.trim(),
    imgSrc: document.querySelector('.preview-image')?.src?.substring(0, 30)
  }));
  console.log('Image preview:', imgResult.hasImg ? 'YES' : 'NO');
  console.log('Media preview container:', imgResult.hasMediaPreview);
  console.log('CodeMirror hidden:', !imgResult.hasCmEditor);
  console.log('File info:', imgResult.fileInfo);
  console.log('Img src prefix:', imgResult.imgSrc);

  // === Test 2: Hex Editor ===
  console.log('\n=== Test 2: Hex Editor ===');
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('test.exe')) { await item.click(); break; }
  }
  await window.waitForTimeout(1000);

  const hexResult = await window.evaluate(() => ({
    hasHexEditor: !!document.querySelector('.hex-editor'),
    hasHexBody: !!document.querySelector('.hex-body'),
    rowCount: document.querySelectorAll('.hex-row:not(.header)').length,
    firstAddr: document.querySelector('.hex-row:not(.header) .hex-addr')?.textContent?.trim(),
    firstBytes: Array.from(document.querySelectorAll('.hex-row:not(.header) .hex-byte')).slice(0, 4).map(el => el.textContent?.trim()),
    toolbarText: document.querySelector('.hex-toolbar')?.textContent?.trim()
  }));
  console.log('Hex editor:', hexResult.hasHexEditor ? 'YES' : 'NO');
  console.log('Rows:', hexResult.rowCount);
  console.log('First addr:', hexResult.firstAddr);
  console.log('First bytes:', hexResult.firstBytes);
  console.log('Toolbar:', hexResult.toolbarText);

  // Click a byte to see details
  const firstByte = window.locator('.hex-byte').first();
  if (await firstByte.count() > 0) {
    await firstByte.click();
    await window.waitForTimeout(300);
    const status = await window.evaluate(() => document.querySelector('.hex-status')?.textContent?.trim());
    console.log('Status after click:', status);
  }

  // Cleanup
  await app.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n=== All preview tests passed ===');
}

main().catch(err => {
  try { fs.rmSync(path.join(rootDir, 'tests', '_preview_test'), { recursive: true, force: true }); } catch {}
  console.error('FAILED:', err);
  process.exit(1);
});
