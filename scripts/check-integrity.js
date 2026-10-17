const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { builtinModules } = require('node:module');
const acorn = require('acorn');

const root = path.resolve(__dirname, '..');
const errors = [];
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const ignored = new Set(['node_modules', '.git', '.cloudbase', 'coverage', 'miniprogram_npm']);
const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const fail = (file, message) => errors.push(`${relative(file)}: ${message}`);

/**
 * 枚举仓库文件，跳过依赖、Git 与本地云缓存。
 * @param {string} directory 绝对目录路径。
 * @returns {string[]} 文件绝对路径列表。
 */
function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

/**
 * 读取并校验 JSON；收集错误后继续检查其他文件。
 * @param {string} file 文件绝对路径。
 * @returns {*} JSON 值，失败时为 null。
 */
function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(file, error.message);
    return null;
  }
}

/**
 * 检查文件是否存在，并校验 GitHub Linux runner 所需的精确大小写。
 * @param {string} owner 引用方文件。
 * @param {string} target 引用目标绝对路径。
 * @returns {boolean} 目标是否为大小写正确的文件。
 */
function requireFile(owner, target) {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    fail(owner, `缺少文件 ${relative(target)}`);
    return false;
  }
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    if (!fs.readdirSync(current).includes(segment)) {
      fail(owner, `路径大小写不一致 ${relative(target)}`);
      return false;
    }
    current = path.join(current, segment);
  }
  return true;
}

/**
 * 查找模块所属的最近 package.json，确保云函数独立部署时依赖也有声明。
 * @param {string} file JS 文件绝对路径。
 * @returns {object} 包描述。
 */
function packageFor(file) {
  let directory = path.dirname(file);
  while (directory.startsWith(root)) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) return readJSON(manifest) || {};
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  return {};
}

/**
 * 检查静态 import/require；动态导入需显式实现解析，避免漏检。
 * @param {string} file 引用方路径。
 * @param {string} specifier 模块标识符。
 * @returns {void}
 */
function checkModule(file, specifier) {
  if (builtins.has(specifier)) return;
  if (!specifier.startsWith('.')) {
    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    const manifest = packageFor(file);
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    if (!declared[name]) fail(file, `外部依赖未声明 ${name}`);
    return;
  }
  const base = path.resolve(path.dirname(file), specifier);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  const target = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
  if (!target) fail(file, `模块无法解析 ${specifier}`);
  else {
    requireFile(file, target);
    if (relative(file).startsWith('cloudfunctions/')) {
      const deploymentRoot = relative(file).split('/').slice(0, 2).join('/') + '/';
      if (!file.endsWith('.test.js') && !relative(target).startsWith(deploymentRoot)) {
        fail(file, `运行时依赖超出云函数独立部署目录 ${specifier}`);
      }
    }
  }
}

/**
 * 深度访问 Acorn 语法树节点。
 * @param {object} node 当前节点。
 * @param {Function} callback 节点访问函数。
 * @returns {void}
 */
function walk(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (node.type) callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, callback));
    else if (value && typeof value === 'object') walk(value, callback);
  }
}

const files = filesUnder(root);
for (const file of files.filter((item) => item.endsWith('.json'))) readJSON(file);
const appFile = path.join(root, 'miniprogram/app.json');
const app = readJSON(appFile) || {};
const pages = new Set(app.pages || []);
const tabs = new Set(((app.tabBar || {}).list || []).map((entry) => entry.pagePath));
for (const page of pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss'])
    requireFile(appFile, path.join(root, 'miniprogram', `${page}.${extension}`));
}
for (const tab of (app.tabBar || {}).list || []) {
  if (!pages.has(tab.pagePath)) fail(appFile, `Tab 页未注册 ${tab.pagePath}`);
  for (const key of ['iconPath', 'selectedIconPath'])
    requireFile(appFile, path.join(root, 'miniprogram', tab[key]));
}
if (app.sitemapLocation) requireFile(appFile, path.join(root, 'miniprogram', app.sitemapLocation));

let imports = 0;
for (const file of files.filter((item) => item.endsWith('.js'))) {
  let ast;
  try {
    ast = acorn.parse(fs.readFileSync(file, 'utf8'), {
      ecmaVersion: 'latest',
      sourceType: 'module'
    });
  } catch (error) {
    fail(file, error.message);
    continue;
  }
  walk(ast, (node) => {
    const isRequire =
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'require';
    const isImport =
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ImportExpression';
    const source = isRequire ? node.arguments[0] : isImport ? node.source : null;
    if (source) {
      imports++;
      if (source.type === 'Literal' && typeof source.value === 'string')
        checkModule(file, source.value);
      else fail(file, '存在未支持的动态模块引用');
    }
    if (file.endsWith('.test.js')) return;
    if (
      node.type === 'Literal' &&
      typeof node.value === 'string' &&
      /^\/pages\//.test(node.value)
    ) {
      const route = node.value.split('?')[0].slice(1);
      if (!pages.has(route)) fail(file, `页面未注册 ${route}`);
    }
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'wx'
    ) {
      const method = node.callee.property.name;
      const options = node.arguments[0];
      if (
        !['navigateTo', 'redirectTo', 'switchTab'].includes(method) ||
        !options ||
        options.type !== 'ObjectExpression'
      )
        return;
      const url = options.properties.find((property) => property.key.name === 'url');
      if (!url || url.value.type !== 'Literal' || typeof url.value.value !== 'string') return;
      const route = url.value.value.split('?')[0].replace(/^\//, '');
      if ((method === 'switchTab') !== tabs.has(route))
        fail(file, `${method} 与 Tab 配置不匹配 ${route}`);
    }
  });
}
// WXML/WXSS 的静态资源引用；模板绑定和外部资源由开发者工具/真机验证。
for (const file of files.filter((item) => /\.(wxml|wxss)$/.test(item))) {
  const source = fs.readFileSync(file, 'utf8');
  const patterns = file.endsWith('.wxml')
    ? [/\bsrc\s*=\s*['"]([^'"]+)['"]/g]
    : [/@import\s+['"]([^'"]+)['"]/g, /url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      if (/^(?:https?:|data:|cloud:|\/\/)/.test(value) || value.includes('{{')) continue;
      requireFile(
        file,
        value.startsWith('/')
          ? path.join(root, 'miniprogram', value.slice(1))
          : path.resolve(path.dirname(file), value)
      );
    }
  }
}
const protectedFile = path.join(root, 'scripts/protected-files.json');
for (const [file, expected] of Object.entries(readJSON(protectedFile) || {})) {
  const absolute = path.join(root, file);
  if (requireFile(protectedFile, absolute)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    if (actual !== expected) fail(absolute, '受保护文件与原始源码的 SHA-256 不一致');
  }
}
const chatTemplate = fs.readFileSync(path.join(root, 'miniprogram/pages/chat/chat.wxml'), 'utf8');
if (!chatTemplate.includes('回复由人工智能生成，仅供陪伴与参考'))
  fail(appFile, 'AI 生成固定提示丢失');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `完整性通过：${files.length} 个文件、${pages.size} 个页面、${imports} 个静态模块引用；保护文件与 AI 提示均保留。`
  );
  console.log('外部依赖仅验证声明；模板动态绑定、微信编译和真实云端连通性需单独验证。');
}
