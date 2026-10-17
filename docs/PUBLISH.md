# 推送到 GitHub

当前目录是待发布源码，不含 `.git`、真实环境配置或 node_modules；未创建远程仓库，也未执行推送。

## 设置真实仓库地址

在 GitHub 创建一个空仓库（示例名 jianan），不要预先生成 README、LICENSE 或 .gitignore。
将根目录、`cloudfunctions/chat`、`cloudfunctions/ocd` 三份 package.json 的 repository.url 中的 `YOUR_GITHUB_OWNER` 替换为自己的账户/组织。
如果仓库名称不是 jianan，同时替换 URL 中的仓库名。示例没有冒用任何现存项目或作者身份。
MIT LICENSE 沿用原包版权声明。

## 命令序列

在解压后的 jianan 目录打开终端，先完成地址替换，再执行：

```bash
npm ci --ignore-scripts
npm run check

git init -b main
git add .
git status --short
git diff --cached --stat
git diff --cached --check
git commit -m "chore: prepare Jianan open-source repository"
git remote add origin https://github.com/YOUR_GITHUB_OWNER/jianan.git
git push -u origin main
```

git remote 的 URL 也需要替换。Git 提示身份未配置时，用自己的姓名和邮箱配置当前仓库后再提交：

```bash
git config user.name "YOUR_NAME"
git config user.email "YOUR_EMAIL"
```

提交前核对暂存区不存在 `.env`、cloudbaserc.json、project.config.json、真实会话或健康记录。
完整文件清单见 [FILE_LIST.md](FILE_LIST.md)，本次验证结果见 [VALIDATION.md](VALIDATION.md)。
如需 GitHub 私密漏洞报告，推送后在仓库设置启用相应功能。
