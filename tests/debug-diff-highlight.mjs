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
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`  [ERROR] ${msg.text()}`);
  });
  await window.waitForTimeout(2000);

  // Add project
  await window.evaluate(async (p) => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace'); const ui = pi._s.get('ui');
    const project = await ws.addProject(p);
    if (project) ui.addPane({ id: 'p1', terminalId: 'term-1', projectId: project.id, projectName: project.name, projectPath: project.path, agentId: null, title: project.name });
  }, rootDir);
  await window.waitForTimeout(1500);

  // Open README.md (modified file)
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('README.md')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);

  // Enter diff
  await window.locator('.diff-btn').click();
  await window.waitForTimeout(1500);

  // Check for diff highlights
  const highlights = await window.evaluate(() => {
    const deleted = document.querySelectorAll('.cm-diff-deleted');
    const added = document.querySelectorAll('.cm-diff-added');
    const modified = document.querySelectorAll('.cm-diff-modified');

    // Get some highlighted line content
    const deletedTexts = Array.from(deleted).slice(0, 3).map(el => el.textContent?.substring(0, 50));
    const addedTexts = Array.from(added).slice(0, 3).map(el => el.textContent?.substring(0, 50));

    return {
      deletedCount: deleted.length,
      addedCount: added.length,
      modifiedCount: modified.length,
      deletedSample: deletedTexts,
      addedSample: addedTexts
    };
  });

  console.log('\n=== Diff Highlights ===');
  console.log(`Deleted lines (red): ${highlights.deletedCount}`);
  console.log(`Added lines (green): ${highlights.addedCount}`);
  console.log(`Modified lines (yellow): ${highlights.modifiedCount}`);
  console.log('Deleted samples:', highlights.deletedSample);
  console.log('Added samples:', highlights.addedSample);

  if (highlights.deletedCount > 0 || highlights.addedCount > 0) {
    console.log('\n✅ Diff highlighting is working!');
  } else {
    console.log('\n❌ No diff highlights found');
  }

  await app.close();
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
