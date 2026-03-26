import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 创建临时测试文件
const testFile = path.join(rootDir, 'tests', '_test_edit.txt');
fs.writeFileSync(testFile, 'Hello World\nLine 2\nLine 3\n', 'utf-8');

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

  // Add project
  console.log('\n=== Add project (orchestrix root) ===');
  await window.evaluate(async (p) => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pinia._s.get('workspace');
    await ws.addProject(p);
  }, rootDir);
  await window.waitForTimeout(1000);

  // === Test 1: Check editor exists but empty ===
  console.log('\n=== Test 1: Editor empty state ===');
  const emptyEditor = await window.locator('.editor-empty').count();
  console.log(`Editor empty state visible: ${emptyEditor > 0 ? 'YES' : 'NO'}`);

  // === Test 2: Click a file to open in editor ===
  console.log('\n=== Test 2: Open package.json ===');
  // Expand the file tree and find package.json
  const fileItems = await window.locator('.file-tree-item .item-row').all();
  for (const item of fileItems) {
    const text = await item.textContent();
    if (text?.includes('package.json')) {
      await item.click();
      break;
    }
  }
  await window.waitForTimeout(1000);

  // Check editor tabs appeared
  const tabCount = await window.locator('.editor-tabs .tab').count();
  console.log(`Editor tabs: ${tabCount}`);

  // Check editor has content
  const hasEditorContent = await window.locator('.cm-editor').count();
  console.log(`CodeMirror editor visible: ${hasEditorContent > 0 ? 'YES' : 'NO'}`);

  // Check the content contains "orchestrix"
  const editorContent = await window.evaluate(() => {
    const cm = document.querySelector('.cm-content');
    return cm?.textContent?.substring(0, 100) || 'NO CONTENT';
  });
  console.log(`Editor content preview: ${editorContent}`);

  // Check status bar
  const statusBar = await window.locator('.status-bar').textContent();
  console.log(`Status bar: ${statusBar?.trim()}`);

  // === Test 3: Open a second file ===
  console.log('\n=== Test 3: Open README.md ===');
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    const text = await item.textContent();
    if (text?.includes('README.md')) {
      await item.click();
      break;
    }
  }
  await window.waitForTimeout(500);
  const tabCount2 = await window.locator('.editor-tabs .tab').count();
  console.log(`Editor tabs after opening 2nd file: ${tabCount2}`);

  const activeTab = await window.locator('.editor-tabs .tab.active').textContent();
  console.log(`Active tab: ${activeTab?.trim()}`);

  // === Test 4: Switch between tabs ===
  console.log('\n=== Test 4: Switch tabs ===');
  await window.locator('.editor-tabs .tab').first().click();
  await window.waitForTimeout(500);
  const activeTab2 = await window.locator('.editor-tabs .tab.active').textContent();
  console.log(`After clicking first tab, active: ${activeTab2?.trim()}`);

  // === Test 5: Edit and save ===
  console.log('\n=== Test 5: Edit and save a test file ===');
  // Open the test file
  // First expand "tests" directory
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    const text = await item.textContent();
    if (text?.includes('tests')) {
      await item.click();
      break;
    }
  }
  await window.waitForTimeout(500);

  // Click _test_edit.txt
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    const text = await item.textContent();
    if (text?.includes('_test_edit.txt')) {
      await item.click();
      break;
    }
  }
  await window.waitForTimeout(500);

  // Type into the editor
  const cmContent = window.locator('.cm-content');
  if (await cmContent.count() > 0) {
    await cmContent.click();
    await cmContent.press('End');
    await cmContent.pressSequentially('EDITED BY PLAYWRIGHT');
    await window.waitForTimeout(300);

    // Check modified indicator
    const modifiedDot = await window.locator('.modified-dot').count();
    console.log(`Modified indicator visible: ${modifiedDot > 0 ? 'YES' : 'NO'}`);

    const modifiedStatus = await window.locator('.status-bar .modified').count();
    console.log(`Status bar "Modified": ${modifiedStatus > 0 ? 'YES' : 'NO'}`);

    // Save with Cmd+S
    await window.keyboard.press('Meta+s');
    await window.waitForTimeout(500);

    // Verify file was saved
    const savedContent = fs.readFileSync(testFile, 'utf-8');
    const wasSaved = savedContent.includes('EDITED BY PLAYWRIGHT');
    console.log(`File saved to disk: ${wasSaved ? 'YES' : 'NO'}`);
    console.log(`Saved content: ${savedContent.trim()}`);

    // Check modified indicator gone after save
    const modifiedDotAfter = await window.locator('.modified-dot').count();
    console.log(`Modified indicator after save: ${modifiedDotAfter > 0 ? 'still showing' : 'cleared'}`);
  } else {
    console.log('FAIL: CodeMirror content not found');
  }

  // === Test 6: Close tab ===
  console.log('\n=== Test 6: Close tab ===');
  const tabsBefore = await window.locator('.editor-tabs .tab').count();
  const closeBtn = window.locator('.editor-tabs .tab.active .tab-close');
  if (await closeBtn.count() > 0) {
    await closeBtn.click();
    await window.waitForTimeout(300);
    const tabsAfter = await window.locator('.editor-tabs .tab').count();
    console.log(`Tabs: ${tabsBefore} -> ${tabsAfter}`);
  }

  // === Test 7: Drag splitter ===
  console.log('\n=== Test 7: Split handle exists ===');
  const splitHandle = await window.locator('.split-handle').count();
  console.log(`Split handle visible: ${splitHandle > 0 ? 'YES' : 'NO'}`);

  // Cleanup
  fs.unlinkSync(testFile);
  await app.close();
  console.log('\n=== All editor tests complete ===');
}

main().catch(err => {
  fs.existsSync(testFile) && fs.unlinkSync(testFile);
  console.error('FAILED:', err);
  process.exit(1);
});
