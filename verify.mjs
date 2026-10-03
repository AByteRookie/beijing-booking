// 验证脚本：结构自检 + 真实浏览器布局实测
// 用法：node verify.mjs   （需要本机已安装 Chrome 或 Edge）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '北京旅游景点预约入口汇总.html');
const html = fs.readFileSync(OUT, 'utf8');

const checks = [];
const ck = (ok, msg) => checks.push((ok ? 'PASS  ' : 'FAIL  ') + msg);

ck(/^<!DOCTYPE html>/.test(html.trim()), 'DOCTYPE 存在');
ck(html.includes('</html>'), 'HTML 闭合');
ck((html.match(/<script/g)||[]).length === (html.match(/<\/script>/g)||[]).length, 'script 标签配对');
ck((html.match(/<style/g)||[]).length === (html.match(/<\/style>/g)||[]).length, 'style 标签配对');
ck(!/TODO|FIXME|请用户补充|__DATA__/.test(html), '无 TODO / 占位符残留');

const m = html.match(/const PAYLOAD = (\{[\s\S]*?\});\nconst DATA/);
ck(!!m, 'PAYLOAD 数据已注入');
const payload = JSON.parse(m[1]);
ck(payload.records.length === 70, '记录数 = 70（实际 ' + payload.records.length + '）');
ck(payload.categories.length === 7, '一级分类数 = 7');

const need = ['name','district','category','tags','channelType','channelName','entry','hours','rules','price','difficulty','remark','status','confidence','source'];
let bad = 0;
payload.records.forEach(r => need.forEach(k => { if(!r[k] || !String(r[k]).trim()) { bad++; console.log('  空字段', r.name, k); } }));
ck(bad === 0, '所有记录字段非空');
ck(payload.records.every(r => r.links.length >= 1 || r.status === '需核实'), '每条记录均有官方链接或标注需核实');
ck(payload.records.every(r => r.sources.length >= 1), '每条记录均有来源链接');
ck(payload.records.every(r => ['已确认','需核实'].includes(r.status)), '信息状态取值合法');
ck(payload.records.every(r => ['高','中','低'].includes(r.confidence)), '置信度取值合法');
ck(payload.records.every(r => !(r.status==='需核实' && r.confidence==='高')), '无“需核实+高置信度”矛盾条目');

const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
ck(js.includes('function cardHTML'), 'cardHTML 渲染函数存在');
ck(js.includes('function openDetail'), 'openDetail 详情函数存在');
ck(js.includes('data-copy'), '复制按钮已接入');
ck(js.includes('data-detail'), '详情按钮已接入');
ck(js.includes('exportCsv'), 'CSV 导出存在');
ck(js.includes('exportJson'), 'JSON 导出存在');
ck(html.includes('aria-modal="true"'), '详情窗口含 aria-modal（可访问性）');
ck(/@media\s*\(max-width/.test(html) && (html.match(/@media/g)||[]).length >= 4, '存在响应式媒体查询（>=4 断点）');
ck(/@media\s*\(max-width:\s*375px\)/.test(html) && /@media\s*\(max-width:\s*1440px\)|minmax|clamp/.test(html), '适配 375px–1440px');

// 真实执行渲染纯函数：注入数据后截取到启动区之前
const head = 'const PAYLOAD = __P__; const DATA = PAYLOAD.records; const CATEGORIES = PAYLOAD.categories; const BUILD_TIME="2026-09-24";';
const body = js.replace(/const PAYLOAD = \{[\s\S]*?\};\r?\n(?=const DATA)/, '')
               .replace(/const DATA = PAYLOAD\.records;/, '')
               .replace(/const CATEGORIES = PAYLOAD\.categories;/, '')
               .replace(/const BUILD_TIME = '[^']*';/, '')
               .replace(/const grid = document[\s\S]*$/, 'return {cardHTML,tagHTML,esc,catShort,isFree,needBook,isNoBook,matchQuery,cardClass,filterCount,FILTER_DEFS};');
const fn = new Function('return (function(){' + head.replace('__P__', m[1]) + body + '})();');
const api = fn();

const c0 = api.cardHTML(payload.records[0]);
ck(c0.includes('class="card') && c0.includes('</article>'), '卡片 HTML 结构完整');
ck(c0.includes(payload.records[0].name), '卡片含景点名称');
const hits = payload.records.filter(r => api.matchQuery(r, '故宫')).map(r => r.name);
ck(hits.includes('故宫博物院'), '搜索“故宫”命中故宫博物院（含跨字段命中 ' + hits.length + ' 条）');
const hits2 = payload.records.filter(r => api.matchQuery(r, '免费 海淀')).map(r => r.name);
ck(hits2.length >= 1, '多关键词 AND 搜索可用（免费+海淀 → ' + hits2.length + ' 条）');
ck(payload.records.filter(r => api.isNoBook(r)).length === 11, '免预约条目 = 11');
ck(payload.records.filter(r => api.needBook(r)).length === 59, '需预约/购票条目 = 59');
ck(api.FILTER_DEFS.length >= 10, '快捷筛选维度 >= 10（' + api.FILTER_DEFS.length + '）');

/* =========================================================
   第二阶段：真实浏览器布局实测
   教训：仅检查“媒体查询存在”无法发现布局溢出。
   必须在真实浏览器中测量 document.scrollWidth，覆盖 375–1440 各断点。
   ========================================================= */
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));

async function measureAt(width) {
  const { spawn } = await import('node:child_process');
  const userDir = path.join(os.tmpdir(), `dsh-layout-${width}-${Date.now()}`);
  const proc = spawn(browserPath, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`, `--window-size=${width},900`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('devtools 超时')), 25000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(t); res(m[0]); }
    });
  });

  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params, sessionId) => new Promise((res) => {
    const msgId = ++id;
    pending.set(msgId, res);
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride',
    { width, height: 900, deviceScaleFactor: 1, mobile: width <= 480 }, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: 'file:///' + OUT.replace(/\\/g, '/') }, sessionId);
  await new Promise((r) => setTimeout(r, 1500));

  const expr = `(() => {
    const de = document.documentElement;
    // 注意：详情抽屉关闭时被 translateX(102%) 推到画布外，其子元素也会“越界”，
    // 因此必须把「任何位于 #drawer 内的元素」都排除，而不是只排除 #drawer 本身。
    const clippedBy = (e) => { let p = e.parentElement;
      while (p && p !== document.body) { const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return p; p = p.parentElement; }
      return null; };
    const real = [];
    document.querySelectorAll('body *').forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.right > de.clientWidth + 1 && !e.closest('#drawer') && !clippedBy(e))
        real.push(e.tagName + '.' + String(e.className || '').split(/\\s+/)[0] + '@' + Math.round(r.right));
    });
    const cl = document.querySelector('.catlist');
    const g = document.getElementById('grid');
    return JSON.stringify({
      viewport: de.clientWidth,
      // 媒体查询按 window.innerWidth 判定，clientWidth 会减去滚动条宽度，
      // 用 clientWidth 分桶会把 940px 误判为 <=940 区间之外的边界错误。
      innerWidth: window.innerWidth,
      overflow: de.scrollWidth - de.clientWidth,
      cards: document.querySelectorAll('#grid .card').length,
      statBoxes: document.querySelectorAll('#stats .stat').length,
      catBtns: document.querySelectorAll('#catnav .catbtn').length,
      chips: document.querySelectorAll('#filters .chip').length,
      gridW: Math.round(g.getBoundingClientRect().width),
      gridCols: getComputedStyle(g).gridTemplateColumns.split(' ').length,
      cardW: Math.round(document.querySelector('#grid .card').getBoundingClientRect().width),
      catlistOverflowX: getComputedStyle(cl).overflowX,
      catlistScrollable: cl.scrollWidth > cl.clientWidth + 1,
      realOverflow: real.slice(0, 4),
      realOverflowCount: real.length
    });
  })()`;
  const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId);
  await send('Browser.close', {}).catch(() => {});
  proc.kill();
  return JSON.parse(result.value);
}

if (!browserPath) {
  checks.push('SKIP  未找到 Chrome/Edge，跳过布局实测');
} else {
  const widths = [375, 414, 640, 768, 940, 941, 1024, 1440];
  const rows = [];
  for (const w of widths) {
    const r = await measureAt(w);
    rows.push(r);
    ck(r.overflow === 0, `布局 @${w}px 无横向溢出（实测 ${r.overflow}px）`);
    ck(r.cards === 70, `布局 @${w}px 渲染 70 张卡片`);
    ck(r.realOverflowCount === 0, `布局 @${w}px 无元素逃出可滚动祖先`);
    ck(r.statBoxes === 6 && r.catBtns === 8 && r.chips === 13,
      `布局 @${w}px 统计/分类/筛选齐备（${r.statBoxes}/${r.catBtns}/${r.chips}）`);
  }
  // 窄屏必须单列，宽屏必须多列
  const narrow = rows.find((r) => r.innerWidth <= 480);
  const wide = rows.find((r) => r.innerWidth >= 1400);
  ck(narrow && narrow.gridCols === 1, `≤480px 卡片单列（实测 ${narrow && narrow.gridCols} 列，卡宽 ${narrow && narrow.cardW}px）`);
  ck(wide && wide.gridCols >= 3, `≥1400px 卡片多列（实测 ${wide && wide.gridCols} 列）`);
  // 分类导航：在装不下的宽度上必须真的可滚动（曾被 min-width 缺陷打破）
  const strip = rows.filter((r) => r.innerWidth <= 940);
  ck(strip.every((r) => r.catlistOverflowX === 'auto'),
    '≤940px 分类导航 overflow-x:auto（实测 ' + strip.map((r) => r.innerWidth + ':' + r.catlistOverflowX).join(' ') + '）');
  ck(rows.filter((r) => r.innerWidth > 940).every((r) => r.catlistOverflowX === 'visible'),
    '>940px 分类导航回到纵向侧栏');
  const tooNarrow = strip.filter((r) => r.catlistScrollable);
  ck(tooNarrow.length >= 1 && tooNarrow.every((r) => r.overflow === 0),
    '分类导航可横向滚动且不撑破页面（实测 ' + tooNarrow.map((r) => r.innerWidth + 'px').join('/') + ' 可滚动，页面溢出均为 0）');
  // 关键回归：卡片宽度不得超过其容器，否则就是旧的“1fr 被内容撑爆”缺陷
  ck(rows.every((r) => r.cardW <= r.gridW + 1),
    '卡片宽度不超过网格容器（' + rows.map((r) => r.cardW + '/' + r.gridW).join(' ') + '）');
}

console.log(checks.join('\n'));
const fails = checks.filter((c) => c.startsWith('FAIL'));
console.log('\n' + (checks.length - fails.length) + '/' + checks.length + ' 项通过');
process.exit(fails.length ? 1 : 0);
