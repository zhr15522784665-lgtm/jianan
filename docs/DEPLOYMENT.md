# 部署与验收

## 1. 本地准备

- 安装 Node.js 22 或 24（含 npm）与微信开发者工具稳定版。
- 准备自己的小程序 AppID、已开通的云开发环境及 DeepSeek API Key。
- 在仓库根目录运行 `npm ci --ignore-scripts`、`npm run check`。根目录安装的是开发工具；测试通过 mock 隔离云 SDK 和模型网络。

PowerShell：

```powershell
Copy-Item project.config.example.json project.config.json
Copy-Item .env.example .env
```

Bash：

```bash
cp project.config.example.json project.config.json
cp .env.example .env
```

编辑 `project.config.json` 的 `appid`；编辑 **`miniprogram/app.js` 的 `CLOUD_ENV`** 为实际云环境 ID。
CLI 部署时 `cloudbaserc.json` 的 `envId` 也必须与其一致。AppID 与云环境 ID 是两个不同的值。
`jianan_cloud_env_override` 本地 storage 可覆盖前端环境；切换环境后应检查或清除该键。
微信开发者工具导入的是仓库根目录，配置中的 miniprogramRoot/cloudfunctionRoot 已指定子目录。

## 2. 配置模型

默认保留 `https://api.deepseek.com` 与原包的 `deepseek-flash`；模型可用性及参数支持需由自己的服务账户实测确认。
只在服务端设置真实 Key；前端不配置 Key。根目录 `.env` 只供本地读取，不会自动随云函数上传。
推荐在云开发控制台 → 云函数 → chat → 函数配置 → 环境变量填写 `.env.example` 中的变量。
备用通道默认关闭；如需使用，可配置 `AIPING_API_KEY`、`AIPING_BASE_URL` 和可选的 `AIPING_MODEL`。

其他方式：将 `.env` 复制至 `cloudfunctions/chat/.env` 后部署，或者使用 CLI 的本地 `cloudbaserc.json` 环境变量配置。
这些真实配置均受 `.gitignore` 排除；忽略 Git 并不等于阻止云端打包，函数目录 `.env` 仍会随部署上传。
非空平台环境变量优先于文件；当前 env-loader 会用文件值补齐不存在或空字符串的环境变量。
环境加载器从函数目录向上找第一个 `.env`，找到后不会合并父目录文件。

三个 `*_MODE` 默认 shadow：仅用于比较/观察，**不代表四级新规则已正式接管全部体验**。
特别是安全路由的 shadow 仍按原有旧规则产生用户体验；确认回归与现场验收后，部署者应明确选择 `on`。
不要为了检查 Key 而在模块启动时抛错，否则会阻断原有“不依赖模型即可返回固定危机文案”的路径。

## 3. 上传云函数

在开发者工具中选择实际云环境，分别右键 `cloudfunctions/chat` 和 `cloudfunctions/ocd` → 上传并部署：云端安装依赖。
两个函数均附独立 package-lock.json，并将 `wx-server-sdk` 固定为 4.0.2。
需要本地安装生产依赖时，在各函数目录执行 `npm ci --omit=dev --ignore-scripts`。
上传时不要把根目录 node_modules 当成小程序 npm 依赖构建。

到云开发控制台核对超时：两个函数都至少设为 **60 秒**（与示例配置一致）。
原有模型链路包含主通道及可选备用通道、结构化输出失败重试，极端情况下总耗时可能超过 60 秒；
当前没有端到端总时限控制，因此 60 秒不构成所有降级场景的完成保证。
应在目标环境验收超时行为；如果平台允许，可调整函数超时，并检查客户端调用上限。

可选 CLI 部署：

```bash
npm install -g @cloudbase/cli
tcb login
cp cloudbaserc.example.json cloudbaserc.json
# 编辑 envId 和环境变量后，在仓库根目录执行
tcb functions:deploy chat
tcb functions:deploy ocd
```

CLI 命令及支持的 Node.js 运行时以安装版本、地域和控制台为准。
示例保留原包的 `Nodejs18.15`，这与本地 CI 使用 Node.js 22/24 分开；部署时优先选择平台支持的维护中运行时并重新验收。
开发者工具右键上传不会读取 cloudbaserc.json 中的 timeout/envVariables，必须在控制台配置。

## 4. 数据库

建议先手工创建以下四个集合并设置权限，再向用户开放；ocd 云函数也会尝试自动创建缺失集合，但不会设置安全规则。

| 集合            | 内容                   |
| --------------- | ---------------------- |
| ocd_profiles    | 用户档案、敏感信息同意 |
| ocd_logs        | 症状和暴露练习日志     |
| exposure_steps  | 恐惧阶梯和进度         |
| ocd_assessments | 自评答案、分数和版本   |

每个集合使用自定义客户端规则：

```json
{ "read": false, "write": false }
```

这将禁止前端直接访问；云函数仍可通过管理权限访问，并由 `_openid` 查询隔离用户。
所有用户身份只从 `cloud.getWXContext().OPENID` 取得，ocd 的普通 HTTP 调用缺少可信微信身份会被拒绝。
如控制台提示需要复合索引，按实际查询方向添加：

| 集合/场景            | 字段顺序                                               |
| -------------------- | ------------------------------------------------------ |
| ocd_logs 列表与分页  | \_openid 升序、created_at 降序、\_id 升序              |
| ocd_logs 阶梯历史    | \_openid 升序、stepId 升序、created_at 降序、\_id 升序 |
| exposure_steps 列表  | \_openid 升序、level 升序、\_id 升序                   |
| ocd_assessments 历史 | \_openid 升序、created_at 降序                         |

不同环境可能已有单字段索引或不同复合索引要求；以真实请求返回的控制台索引建议为准，不把本地 mock 测试视为索引部署验证。

## 5. 微信端验收

1. 编译后检查全部 21 个注册页面，确认底栏和“缓一缓”跳转正常。
2. 用虚构输入验证普通对话、结构化情绪回包和 on/shadow/off 三档。
3. 使用 `cloudfunctions/chat/testdata/safety-cases.json` 的虚构用例验证安全分流、追问、危机固定文案及热线卡；不要向真实模型发送个人健康记录作为测试。
4. 自评保持原有 12/18 题，验证保存需独立同意；新增阶梯、完成一次暴露、分页看日志和周统计。
5. 由两个测试微信用户检查相互不可见，并在“关于”页验证云端记录删除确认。
6. 检查 AI 固定提示、隐私政策、用户协议及部署方应补的标识与主体信息。

目前的离线测试不能替代微信编译、真机、真实模型权限或真实数据库安全规则验收。

## 常见故障

| 现象                    | 检查位置                                                    |
| ----------------------- | ----------------------------------------------------------- |
| NO_KEY_DEEPSEEK         | chat 云端环境变量；根目录 .env 不会自动上传                 |
| 环境不存在 / 函数找不到 | app.js 的 CLOUD_ENV、storage 覆盖值、实际部署环境与函数名称 |
| 约 3 秒超时             | 云函数控制台超时；右键部署不读 CLI 配置                     |
| 401/402/模型不存在      | 密钥权限、余额、模型代号与服务账户实际支持情况              |
| 日志/阶梯加载失败       | 四个集合、复合索引、openid 和实际函数部署状态               |
| shadow 没有新交互       | 档位的既定行为；验收后再明确改为 on                         |

原有微信内容安全检测异常时采用 fail-open；生产部署应确认 msgSecCheck 权限、日志访问和告警策略。
模型服务可能处理并按自身策略留存对话；本项目未实现消息级隐式标识，也不代表满足上线所需全部法规或平台资质。
