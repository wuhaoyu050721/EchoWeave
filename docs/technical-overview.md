# EchoWeave 技术概览

适用版本：**1.1.1 / Android 版本码 111**。本说明按当前仓库实现整理；版本变更见 [更新日志](../CHANGELOG.md)，云端协议与部署见 [云端增量同步](cloud-incremental-sync-v1.md)。文档中的实现能力不代表已完成 APK 真机验收或生产部署。

## 平台与模块组装

应用使用 Vue 3 与 uni-app，共用业务服务和界面，按运行环境选择存储、加密、网络与文件适配器。浏览器开发预览由 Vite 提供，不等同于 Android 原生运行时。

| 层次 | 入口与职责 |
| --- | --- |
| 页面与状态 | [主页面](../pages/index/index.vue) 组织导航、聊天、设置与弹层；[ui-state.js](../src/ui-state.js) 管理页面切换和表单状态。 |
| 平台选择 | [create-platform-services.js](../src/app/create-platform-services.js) 识别 App 运行时，等待原生能力就绪；打包 App 缺少 SQLite 或网络能力时明确报错。 |
| Android | [create-app-services.js](../src/app/create-app-services.js) 组装 SQLite、Android Keystore、原生附件选择、流式网络与代理适配器。 |
| 浏览器 | [create-browser-services.js](../src/app/create-browser-services.js) 组装 IndexedDB、Web Crypto、Fetch 和浏览器附件适配器。 |
| 业务 | [ChatService](../src/services/chat-service.js) 管理发送、重试、续写与持久化；[ProviderService](../src/services/provider-service.js) 管理接口资料、密钥与模型列表。 |
| 云端 | [create-cloud-services.js](../src/app/create-cloud-services.js) 组装登录、完整备份、增量同步与调度服务。PHP/MySQL 服务位于 [server](../server)。 |
| 工作区 | [WorkspaceServiceManager](../src/workspace/workspace-service-manager.js) 切换本地与账号工作区；[workspace-id.js](../src/workspace/workspace-id.js) 根据服务域和不可变账号 ID 派生账号数据库标识。 |

[main.js](../main.js) 在 `APP-PLUS` 构建中注册原生 API：

- [ai-chat-keystore](../uni_modules/ai-chat-keystore)：密钥存储、AES-GCM 加解密与安全随机数。
- [ai-chat-streaming](../uni_modules/ai-chat-streaming)：HTTP 流式请求、取消、事件回调与本机 HTTP 代理端口检测。
- [ai-chat-attachment-picker](../uni_modules/ai-chat-attachment-picker)：系统附件选择与下载文件写入。

原生模块或注册方式变更后需要重新构建包含模块的基座或安装包；浏览器刷新不能验证这些接口。设备凭证使用独立设备数据库；业务数据库则按工作区隔离。工作区释放会停止正在生成的请求并清理相关服务，旧会话回调还需通过工作区与会话归属检查后才能更新当前页面。

## 导航、设置与界面行为

五个主导航是 **会话、联系人、故事、接口、设置**。普通聊天与故事阅读具有各自的展示方式；故事会话不会混入普通会话列表。主页面样式集中在 [main-pages.css](../src/styles/main-pages.css)，接口与设置的样式分别在 [provider-redesign.css](../src/styles/provider-redesign.css)、[settings-redesign.css](../src/styles/settings-redesign.css) 和 [settings-details.css](../src/styles/settings-details.css)。

设置包含以下 **13 个详情视图**，由主页面的 `ui.settingsView` 控制：

| 视图 | 主要内容 |
| --- | --- |
| 对话设置 | 全局系统提示词的启停与编辑。 |
| 流式传输 | 实时输出开关，以及开启流式后可用的分段显示。 |
| 角色状态栏 | 单聊和群聊的状态协议注入、状态栏显示开关。 |
| 网络代理 | Android 智能检测与手动地址，浏览器预览代理配置。 |
| 隐私与安全 | 本地安全信息，以及应用锁、通知、同步等入口。 |
| NSFW 设置 | 相关状态信息的显示设置。 |
| 应用锁 | 设置、关闭和验证数字 PIN，立即锁定。 |
| 回复通知 | 回复完成后的通知开关。 |
| 自动同步 | 云端同步设置和状态。 |
| 数据与存储 | 当前工作区数据统计及备份入口。 |
| 关于应用 | 版本、平台与项目说明。 |
| 检查更新 | 应用内更新说明与 GitHub Releases 入口。 |
| 帮助与反馈 | 使用说明、诊断与 GitHub Issues 入口。 |

其中后四个信息视图复用 [settings-information.vue](../src/components/settings-information.vue)。账号与云端、导入与导出使用独立弹层；设备与诊断进入 [Android 诊断页](../pages/android-diagnostics/index.vue)，不计入上述 13 个视图。设置搜索筛选入口名称和关键词，不搜索用户聊天内容。

[interaction-feedback.css](../src/styles/interaction-feedback.css) 提供短时的菜单、提示、按压和焦点反馈，并响应 `prefers-reduced-motion`。聊天支持 Ctrl/Cmd + Enter 发送，普通 Enter 保留换行；输入法确认和按键重复不应触发重复发送。故事的空输入通过专门的续写操作处理。

## 聊天请求、空回复与持久化

[ProviderRouter](../src/providers/provider-router.js) 路由到 [OpenAI 兼容适配器](../src/providers/openai-provider.js) 或 [Gemini 适配器](../src/providers/gemini-provider.js)。界面中的服务商名称和图标不代表另有一套原生协议；实际请求使用接口配置选定的协议。

### 输出方式

- **普通流式**：解析 SSE 增量并合并到当前回复，界面按短间隔刷新。
- **分段显示**：在流式基础上将完整段落逐条显示为独立气泡，尚未完成的段落继续等待；不改变模型请求为多个独立请求。
- **非流式**：等待完整响应后解析和显示。设置位于 [streaming-setting.js](../src/core/streaming-setting.js)，段落展示逻辑位于 [chat-presentation.js](../src/app/chat-presentation.js)。

流式请求遇到普通 JSON 响应时有受限的兼容解析缓冲，最大 2 MiB；Android 没有触发分块回调、但成功回包包含正文时，会使用该正文。已收到实时分块时不会再次重复拼接成功回包中的聚合正文。

### 响应诊断

[chat-response-diagnostics.js](../src/core/chat-response-diagnostics.js) 记录白名单中的响应形态和计数：HTTP 状态、接收字节、分块数、正文/思考字符数、工具调用数、结束原因等。发送、重试、续写在结束后都检查是否存在可显示内容；仅思考、仅工具调用、仅隐藏状态或记忆、空白正文不能被当成正常的文字回复完成。

[message-response-details.js](../src/app/message-response-details.js) 将这些数据转换为可查看、复制的“响应详情”。该详情不存放密钥、提示词或回复原文；兼容解析用的临时正文缓冲也不会写入诊断字段。旧消息缺少诊断时明确显示“无法确认当时上游是否返回”，不能把未知字节数解释成上游未返回。客户端记录只能证明客户端观察到的响应，不能替代上游服务端日志。

### 并发与草稿

[ChatService](../src/services/chat-service.js) 在准备发送、重试或续写时就占用生成状态，避免准备阶段的快速连点产生重叠请求。流式持久化按队列执行，单次写入失败不会永久阻塞后续保存；最终仍保存失败时保留当前界面正文，并提示未保存。

[composer-drafts.js](../src/app/composer-drafts.js) 将草稿文字和待发送附件按“工作区 + 会话”分开，草稿目前只保留在内存中，不承诺应用关闭后恢复。[chat-composer-methods.js](../src/app/chat-composer-methods.js) 让异步附件、发送和失败恢复操作保留原会话归属，避免切换会话后把内容写入新的输入框。

## 历史记录、自动跟随与故事阅读

普通聊天分批读取历史，每批 60 条，内存展示窗口最多 240 条；可变高度虚拟列表最多挂载视口附近 48 个消息项。附件和发言头像批量、按需读取，头像缓存有数量上限。请求上下文先筛选候选消息，再有界读取需要的附件，相关实现位于 [chat-context.js](../src/core/chat-context.js) 和 [chat-presentation.js](../src/app/chat-presentation.js)。

自动跟随区分“正在阅读”和“跟随最新”两种状态：

1. 用户轻微向上翻阅即暂停跟随，触摸开始时暂缓滚动；滚轮、键盘、触摸方向都参与判断。
2. 暂停时取消已排队的滚动任务、记录实际滚动位置；流式追加、分段显示、最终完成和高度测量都需尊重暂停状态。
3. 手动滚回实际底部（允许 2 px 误差）或点击“回到最新”才恢复跟随。若当前处于较早的数据窗口，“回到最新”会重新加载最新窗口。

该状态机位于 [主页面的聊天滚动逻辑](../pages/index/index.vue)，回归覆盖位于 [chat-scroll-follow.test.js](../tests/chat-scroll-follow.test.js) 和 [streaming-scroll.spec.js](../tests/e2e/streaming-scroll.spec.js)。修改自动滚动时不能只验证回复追加，还要同时验证旧历史加载、异步测量及迟到的回调。

故事模式使用 [story-reader.vue](../src/components/story-reader.vue) 和 [story-reader.js](../src/core/story-reader.js)：

- 支持翻页与连续滚动，阅读位置使用会话、正文块锚点和字符偏移保存；切换模式或重新打开时据此恢复。
- 书签可以添加、删除和跳转；远处书签或保存位置通过有限历史窗口定位，避免一次载入全部正文。
- 已完成正文的分块与分页结果复用缓存；内容或页面容量变化时只重算受影响部分。
- 新内容生成时保留当前阅读位置，不自动翻页。故事角色、世界书具有独立作用域；[story-memory.js](../src/core/story-memory.js) 处理隐藏记忆协议，正文展示不包含记忆标记。备份恢复时重映射角色、世界书、会话和故事关联。

## Android 代理的状态与失败策略

[android-network-proxy.js](../src/platform/app/android-network-proxy.js) 返回 `{ proxyUrl, allowDirectFallback }`，由 [UniRequestTransport](../src/platform/app/uni-request-transport.js) 执行，原生实现见 [ai-chat-streaming 的 Android 模块](../uni_modules/ai-chat-streaming/utssdk/app-android/index.uts)。

| 模式 | 地址选择 | 失败行为 |
| --- | --- | --- |
| 关闭 | 不设置应用内显式代理。 | 按 Android 当前系统网络路由；是否经过 VPN 由系统和 VPN 应用决定。 |
| 手动 | 直接使用保存的地址，不等待检测，也不读取智能模式的失败抑制记录。 | 保留代理错误，不自动直连；关闭再开启保留模式与地址。 |
| 智能 | 探测手机 `127.0.0.1` 的 7890、7897、7898、10809、2080 端口，不使用历史手动地址兜底。 | 未发现端口时按系统网络路由；仅特定连接失败允许一次直连尝试。 |

关键约束：

- 开关先保存，检测独立运行；原生检测总等待上限 **2500 ms**，并发检测复用同一次任务。超时或失效任务的迟到回调不能覆盖新结果。
- 检测缓存 30 秒；明确失败的已探测地址可抑制 5 分钟，手动重检清除抑制。该抑制不影响同地址的手动模式。
- 目前检测只是 TCP 端口可达检查，**“发现端口”不代表代理协议、外网或模型接口已经连通**。
- 智能代理仅在未收到响应头和任何响应字节，且明确拒连、不可达或域名解析失败时允许回退。HTTP 错误、超时、连接重置、取消或已经收到响应时不自动重发模型请求。
- 手动配置在 Android 界面仅接受 `http://` 代理地址，填写 HTTP/混合端口；这是到代理的连接方式，目标模型接口仍可使用 HTTPS。当前界面不提供 SOCKS 或 HTTPS 代理连接配置。
- 显式代理地址存在但安装包缺少原生代理请求能力时，返回明确错误。等待地址解析期间被取消的请求也不会继续发送。

浏览器预览的代理是另一条路径：[BrowserFetchTransport](../src/platform/browser/browser-fetch-transport.js) 在 `/preview/` 下使用 Vite 提供的 `/__ai_proxy` 中间件，配置位于 [vite.browser.config.js](../vite.browser.config.js)。纯静态部署不会自动拥有这个中间件，浏览器预览也不能验证手机本地 `127.0.0.1` 的端口。

## 本地安全、备份与分享边界

本地 API 密钥、全局系统提示词和云端凭证通过 vault 加密。Android 使用 [AndroidKeystoreVault](../src/platform/app/android-keystore-vault.js)，浏览器使用 [WebCryptoVault](../src/platform/browser/web-crypto-vault.js) 的非导出 AES-GCM 密钥。**这不是 SQLite/IndexedDB 整库加密：聊天正文、角色资料及附件仍按业务记录保存。**

应用锁使用 4–8 位数字 PIN、随机盐与 PBKDF2-SHA-256 验证记录，见 [app-lock.js](../src/core/app-lock.js)。应用锁控制进入界面，不将聊天数据库改成加密数据库。

[local-settings.js](../src/core/local-settings.js) 定义禁止随内容迁移的键：`app`、`appLock`、`appLockEnabled`、`cloudDeviceId`、`cloudAutoBackup`、`cloudConfig`、`networkProxy`。便携备份、云端完整备份的导出/导入和增量同步的发送/应用均过滤这些键；`app` 整条记录保留本机，是为了不把其中的 PIN 和锁开关迁移到另一台设备。“本机设置”指不随备份和同步传递，不意味着这些键都存于独立设备数据库。

| 数据通道 | 内容与保护方式 |
| --- | --- |
| 本地 JSON 导入/导出 | [backup-format.js](../src/core/backup-format.js) 使用便携格式，过滤接口密钥和系统提示词等敏感字段及本机设置，但聊天正文、角色和附件仍是可读取的 JSON。[backup-size.js](../src/core/backup-size.js) 限制便携 JSON 导出为 50 MiB；Android 原生本地文件导入也有 50 MiB 读取上限，浏览器本地导入与链接导入目前没有同一客户端大小校验。 |
| 云端完整备份 | [cloud-backup-format.js](../src/core/cloud-backup-format.js) 在内存中解开源设备密钥/提示词，再由 [cloud-backup-crypto.js](../src/core/cloud-backup-crypto.js) 使用同步密码进行 AES-GCM 加密；恢复到新设备时重新使用目标设备 vault 加密。 |
| 云端增量同步 | 每条记录独立加密，包含鉴别记录身份和操作的附加认证数据。协议、冲突与调度详见 [云端增量同步](cloud-incremental-sync-v1.md)。 |
| 云端 JSON 分享 | 上传便携 JSON，**不使用同步密码加密**。持有效链接者可以下载正文和资源；个人分享列表支持撤销，默认七天有效。服务端默认最多 20 条、合计 500 MiB，过期或撤销后下载返回 404。 |

密文备份与增量同步使用 PBKDF2-SHA-256（210,000 次）和 AES-GCM，同步密码最少 12 个字符。当前不支持直接更换既有增量同步密码。[CloudApiClient](../src/services/cloud-api-client.js) 为完整备份和 JSON 传输设置 10 分钟超时，并在大型传输前检查访问令牌有效期。网络中断、限流或服务故障不能被当成凭证失效；刷新明确返回 401 才清除仍属于原会话的凭证。账号/服务器归属校验防止旧请求刷新或注销新的登录会话。

## 服务端部署与验证

客户端新增的 JSON 分享列表、到期和撤销功能依赖服务端更新。发布顺序是：备份数据库 → 确认旧迁移已完成 → 按序执行尚未执行的 004、005、006、**007** → 更新 PHP 和配置 → 验证接口 → 发布客户端。特别是 [007_expiring_json_exports.sql](../server/migrations/007_expiring_json_exports.sql) 必须先于使用 `expires_at` 的服务端代码部署；旧链接在迁移时获得最后七天有效期。迁移不是可反复执行的脚本，部署前应核对迁移记录。

服务端配置示例见 [config.example.php](../server/config.example.php)，具体部署、限制和接口验收见 [云端增量同步文档](cloud-incremental-sync-v1.md#部署与升级)。仅重新打包 APK 不会替服务器执行数据库迁移。

仓库验证入口见 [package.json](../package.json)、[Playwright 配置](../playwright.config.js) 和 [CI](../.github/workflows/ci.yml)：

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

PHP 测试入口位于 [server/tests](../server/tests)，CI 使用 PHP 8.2 与 PDO SQLite 运行路径、备份、JSON 分享安全及同步集成测试；浏览器 CI 使用 Node.js 24，并检查依赖安全。测试数量随代码演进变化，本文不把某次运行数量当作持续有效的通过证明。

发布验收应分别保留证据：

- **代码与浏览器**：自动化测试、构建和桌面/移动视口交互，覆盖代理检测超时、手动模式、空续写、轻微上翻、旧历史窗口、草稿隔离与恢复。
- **最终 Android 包**：在真机安装待发布 APK，验证原生模块、SQLite、Keystore、附件/通知/返回键、实际代理端口与流式输出。移动浏览器视口和模拟原生回调不能替代这一步。
- **实际服务器**：在部署环境核对迁移、请求体限制和登录/同步/分享接口，包含旧链接过期与撤销行为。PHP 的 SQLite 集成测试不能证明生产 MySQL 已迁移或服务已经更新。
