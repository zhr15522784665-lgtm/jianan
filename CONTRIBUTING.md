# 贡献指南

使用 Node.js 22 或 24，在仓库根目录运行 `npm ci --ignore-scripts`，修改后运行 `npm run format` 与 `npm run check`。
根目录开发依赖用于格式化和静态检查，不需要安装微信 SDK 即可运行 mock 测试。云函数各自独立安装生产依赖。

JavaScript 使用两空格、单引号、分号和 camelCase；常量使用 UPPER_SNAKE_CASE。文件延续现有 kebab-case。
保留已有对外字段、数据库字段与 storage 键名，避免破坏客户端和历史数据。新增可复用函数请写 JSDoc，说明输入、输出与失败行为。
WXML 使用两空格并保留微信模板语法；WXSS 使用同一 Prettier 配置。

`safety-router.js` 和 `assess-items.js` 逐字保留原包，`scripts/protected-files.json` 保存其 SHA-256。
普通整理 PR 不应修改文件或更新哈希；将来如需专业内容变更，应独立评审并提供相应回归证据。
不得把危机标签交给模型、移除 AI 生成提示、硬编码密钥或更换境外默认服务。

提交 Issue / PR 时使用虚构输入和已脱敏错误码，不附真实健康信息。CI 不访问真实模型，也不需要 GitHub Secrets。
各 package.json 的 `repository.url` 已指向 `zhr15522784665-lgtm/jianan`；迁移到其他账户或组织时需同步修改，详见 [发布步骤](docs/PUBLISH.md)。
