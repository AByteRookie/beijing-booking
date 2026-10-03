// build.mjs —— 校验北京景点预约数据并生成单文件交互式 HTML
// 数据源：data.tsv（制表符分隔，16 字段）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSV = path.join(__dirname, 'data.tsv');
const TPL = path.join(__dirname, 'template.html');
const OUT = path.join(__dirname, '..', '北京旅游景点预约入口汇总.html');

// 字段顺序（与 data.tsv 列一一对应）
const FIELDS = [
  'name', 'district', 'category', 'tags', 'channelType', 'channelName',
  'entry', 'link', 'hours', 'rules', 'price', 'difficulty',
  'remark', 'status', 'confidence', 'source',
];

// 允许值白名单（用于数据校验，防止脏数据进入页面）
const CATEGORIES = [
  '1-皇家园林与历史古迹',
  '2-博物馆与展览馆',
  '3-科技与艺术场馆',
  '4-公园与自然景观',
  '5-宗教寺庙与文化场所',
  '6-胡同街区与文创园区',
  '7-演出与夜游项目',
];
const TAG_WHITELIST = new Set([
  '免费', '收费',
  '需预约', '免预约', '需购票',
  '热门', '小众',
  '亲子', '文化', '拍照', '夜游',
  '容易', '一般', '困难', '需提前多日',
]);
const CHANNEL_TYPES = new Set([
  '小程序', '公众号', '官网', '电话', '无需预约', '其他',
  '小程序+公众号', '官网+小程序', '官网+公众号', '官网+APP',
  '官网+小程序+公众号', '公众号+小程序', '公众号+小程序+官网',
  '公众号+电话', '官网+公众号+小程序',
]);
const STATUSES = new Set(['已确认', '需核实']);
const CONFIDENCE = new Set(['高', '中', '低']);
const DIFFICULTY = new Set(['容易', '一般', '困难', '需提前多日']);

function parseTsv(text) {
  const rows = [];
  const problems = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.startsWith('#')) return;
    const parts = line.split('\t').map((s) => s.trim());
    if (parts.length !== FIELDS.length) {
      problems.push(`第 ${i + 1} 行列数应为 ${FIELDS.length}，实际 ${parts.length}`);
      return;
    }
    const rec = {};
    FIELDS.forEach((f, k) => { rec[f] = parts[k]; });
    rec.tags = rec.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    rec.links = (rec.link || '').split(/\s+/).filter((s) => /^https?:\/\//.test(s));
    rec.sources = (rec.source || '').split(/\s+/).filter((s) => /^https?:\/\//.test(s));
    rec.no = rows.length + 1;
    rows.push(rec);
  });
  return { rows, problems };
}

const { rows, problems } = parseTsv(fs.readFileSync(TSV, 'utf8'));

// —— 校验 ——
const names = new Set();
for (const r of rows) {
  const at = `【${r.name}】`;
  if (names.has(r.name)) problems.push(`${at} 名称重复`);
  names.add(r.name);
  if (!CATEGORIES.includes(r.category)) problems.push(`${at} 一级分类异常：${r.category}`);
  if (!CHANNEL_TYPES.has(r.channelType)) problems.push(`${at} 渠道类型异常：${r.channelType}`);
  if (!STATUSES.has(r.status)) problems.push(`${at} 信息状态异常：${r.status}`);
  if (!CONFIDENCE.has(r.confidence)) problems.push(`${at} 置信度异常：${r.confidence}`);
  if (!DIFFICULTY.has(r.difficulty)) problems.push(`${at} 预约难度异常：${r.difficulty}`);
  // 一致性校验：预约难度必须同时出现在二级标签中，避免两处口径不一致
  const diffTag = r.tags.filter((t) => DIFFICULTY.has(t));
  if (diffTag.length && diffTag.indexOf(r.difficulty) === -1) {
    problems.push(`${at} 预约难度“${r.difficulty}”与标签（${diffTag.join('/')}）不一致`);
  }
  for (const t of r.tags) {
    if (!TAG_WHITELIST.has(t)) problems.push(`${at} 标签不在白名单：${t}`);
  }
  // 一致性校验：免预约 / 需预约 不应同时出现
  if (r.tags.includes('免预约') && r.tags.includes('需预约')) {
    problems.push(`${at} 同时标注“免预约”与“需预约”`);
  }
  // 一致性校验：免预约条目不应使用预约类渠道类型
  if (r.tags.includes('免预约') && ['小程序', '公众号', '官网', '电话'].includes(r.channelType)) {
    problems.push(`${at} 标注免预约，但渠道类型为“${r.channelType}”`);
  }
  if (!r.tags.some((t) => t === '需预约' || t === '免预约' || t === '需购票')) {
    problems.push(`${at} 缺少预约状态标签（需预约/免预约/需购票）`);
  }
  for (const u of r.links.concat(r.sources)) {
    if (!/^https:\/\//.test(u)) problems.push(`${at} 链接非 https：${u}`);
  }
  // 规则：标注“需核实”的条目置信度不得为“高”
  if (r.status === '需核实' && r.confidence === '高') {
    problems.push(`${at} 状态为“需核实”但置信度为“高”，自相矛盾`);
  }
}

if (problems.length) {
  console.error('数据校验失败：');
  problems.forEach((p) => console.error(' - ' + p));
  process.exit(1);
}

// —— 统计 ——
const stats = {
  total: rows.length,
  confirmed: rows.filter((r) => r.status === '已确认').length,
  need: rows.filter((r) => r.tags.includes('需预约') || r.tags.includes('需购票')).length,
  freeNoBook: rows.filter((r) => r.tags.includes('免预约')).length,
  verify: rows.filter((r) => r.status === '需核实').length,
  free: rows.filter((r) => r.tags.includes('免费')).length,
};
const catCounts = {};
for (const c of CATEGORIES) catCounts[c] = rows.filter((r) => r.category === c).length;

const payload = JSON.stringify({ categories: CATEGORIES, records: rows });
const tpl = fs.readFileSync(TPL, 'utf8');
if (!tpl.includes('/*__DATA__*/')) throw new Error('模板缺少 /*__DATA__*/ 占位符');
const html = tpl.replace('/*__DATA__*/', payload);

fs.writeFileSync(OUT, html, 'utf8');
console.log('OK ->', OUT);
console.log('统计：', JSON.stringify(stats));
console.log('分类分布：', JSON.stringify(catCounts, null, 1));
