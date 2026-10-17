# 推送到 GitHub

本仓库已发布于 `https://github.com/zhr15522784665-lgtm/jianan`，默认分支 `main`；CI 在 Node.js 22 与 24 上运行 `npm run check`。仓库不含真实环境配置与 node_modules。

## 仓库地址

根目录、`cloudfunctions/chat`、`cloudfunctions/ocd` 三份 package.json 的 `repository.url` 均指向 `https://github.com/zhr15522784665-lgtm/jianan.git`。
迁移到其他账户或组织、或更改仓库名时，需同步更新这三处地址与本地 git remote。MIT LICENSE 沿用原包版权声明。

## 命令序列

在 jianan 目录打开终端执行：

```bash
npm ci --ignore-scripts
npm run check

git init -b main
git add .
git status --short
git diff --cached --stat
git diff --cached --check
git commit -m "chore: prepare Jianan open-source repository"
git remote add origin https://github.com/zhr15522784665-lgtm/jianan.git
git push -u origin main
```

Git 提示身份未配置时，用自己的姓名和邮箱配置当前仓库后再提交：

```bash
git config user.name "YOUR_NAME"
git config user.email "YOUR_EMAIL"
```

提交前核对暂存区不存在 `.env`、cloudbaserc.json、project.config.json、真实会话或健康记录。
完整文件清单见 [FILE_LIST.md](FILE_LIST.md)，本次验证结果见 [VALIDATION.md](VALIDATION.md)。
如需 GitHub 私密漏洞报告，推送后在仓库设置启用相应功能。
