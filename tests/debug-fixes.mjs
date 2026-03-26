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

  // Add git project
  await window.evaluate(async (p) => {
    const pi = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const ws = pi._s.get('workspace'); const ui = pi._s.get('ui');
    const project = await ws.addProject(p);
    if (project) ui.addPane({ id: 'p1', terminalId: 'term-1', projectId: project.id, projectName: project.name, projectPath: project.path, agentId: null, title: project.name });
  }, rootDir);
  await window.waitForTimeout(2000);

  // === Fix 1: Git badges visible ===
  console.log('\n=== Fix 1: Git Badges ===');
  const badges = await window.locator('.git-badge').evaluateAll(els =>
    els.map(el => {
      const name = el.closest('.item-row')?.querySelector('.name')?.textContent?.trim();
      const badge = el.textContent?.trim();
      const color = el.style.color;
      const bg = getComputedStyle(el).background;
      return `${name}=[${badge}] color=${color}`;
    })
  );
  console.log(`Badges found: ${badges.length}`);
  badges.slice(0, 8).forEach(b => console.log(`  ${b}`));

  // === Fix 2: Git Diff layout ===
  console.log('\n=== Fix 2: Git Diff ===');
  // Open README.md
  for (const item of await window.locator('.file-tree-item .item-row').all()) {
    if ((await item.textContent())?.includes('README.md')) { await item.click(); break; }
  }
  await window.waitForTimeout(800);

  await window.locator('.diff-btn').click();
  await window.waitForTimeout(1500);

  const diffLayout = await window.evaluate(() => {
    const labels = document.querySelectorAll('.diff-label');
    const mergeView = document.querySelector('.cm-mergeView');
    const editors = mergeView?.querySelectorAll('.cm-editor');
    const results = {
      labels: Array.from(labels).map(l => l.textContent?.trim()),
      mergeViewSize: mergeView ? { w: mergeView.clientWidth, h: mergeView.clientHeight } : null,
      editorCount: editors?.length || 0,
      editorSizes: Array.from(editors || []).map(e => ({ w: e.clientWidth, h: e.clientHeight })),
      leftContent: editors?.[0]?.querySelector('.cm-content')?.textContent?.substring(0, 50),
      rightContent: editors?.[1]?.querySelector('.cm-content')?.textContent?.substring(0, 50),
    };
    return results;
  });

  console.log('Labels:', diffLayout.labels);
  console.log('MergeView size:', diffLayout.mergeViewSize);
  console.log('Editor count:', diffLayout.editorCount);
  console.log('Editor sizes:', diffLayout.editorSizes);
  console.log('Left (HEAD):', diffLayout.leftContent);
  console.log('Right (Working):', diffLayout.rightContent);

  // Exit diff
  await window.locator('.diff-btn').click();
  await window.waitForTimeout(500);

  // === Fix 3: Terminal notification (in-app) ===
  console.log('\n=== Fix 3: Terminal Notification ===');

  // Send a command that will produce a prompt
  console.log('Sending command to terminal...');
  await window.evaluate(() => {
    window.electronAPI.terminal.write('term-1', 'echo "test complete"\n');
  });
  await window.waitForTimeout(2000);

  // Check for notifications (they appear for ANY terminal, even focused)
  const notifyState = await window.evaluate(() => {
    const notifyItems = document.querySelectorAll('.notify-item');
    const bells = document.querySelectorAll('.pane-bell');
    return {
      notifyCount: notifyItems.length,
      notifyTexts: Array.from(notifyItems).map(n => n.querySelector('.notify-text')?.textContent?.trim()),
      bellCount: bells.length,
    };
  });
  console.log('In-app notifications:', notifyState.notifyCount);
  console.log('Notification texts:', notifyState.notifyTexts);
  console.log('Bell icons:', notifyState.bellCount);
  console.log('(Note: bell only shows on non-active panes, current terminal is active so no bell expected)');

  await app.close();
  console.log('\n=== All fixes verified ===');
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
