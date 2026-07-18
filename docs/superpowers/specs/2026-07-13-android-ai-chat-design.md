# Android AI 对话 App 设计规格

## 1. 目标

构建一个基于 uni-app Vue 3 的 Android AI 对话 App。用户可以填写模型服务基础地址、API 密钥和模型名称，直接调用兼容 OpenAI 协议的模型服务。

整体方向保持本地优先：聊天和设置先写入设备数据库。云端能力由 ThinkPHP REST API 和 MySQL 提供，但按阶段交付，避免聊天、加密、账号和多设备同步同时成为首版阻塞项。

## 2. 分阶段范围

### 2.1 V0：Android 真机技术验证

在开发正式功能前完成独立验证工程或验证页面，并锁定：

- HBuilderX 版本。
- uni-app 编译器版本。
- Android 运行时版本。
- 最低 Android 版本和目标 Android 版本。
- 正式 AppID；发布后不得随意变更，否则可能导致 `plus.sqlite` 等本地数据丢失。

真机验证项目：

- POST 请求是否持续触发分块回调。
- 分块是否被运行时合并。
- 中文 UTF-8 字符跨分块截断时能否正确重组。
- SSE 事件、空行和 `[DONE]` 能否正确识别。
- 调用 `abort()` 后是否仍会收到延迟分块。
- App 切到后台后连接的行为。
- OpenAI、NewAPI 和其他兼容接口的差异。

验收结果必须明确选择一种传输实现：

- `UniRequestTransport`：现有运行时可稳定接收流式响应时使用。
- `AndroidNativeTransport`：uni-app 请求能力不稳定时，使用 UTS/原生插件和 OkHttp。

### 2.2 V1：本地聊天版

V1 只包含：

- 多个 OpenAI 兼容接口配置。
- `/v1/models` 模型列表和手动模型名称。
- 流式聊天、停止生成和重试。
- 多会话、重命名、删除和搜索。
- SQLite 持久化和数据库迁移。
- 全局系统提示词及会话覆盖。
- Android Keystore 保护本地敏感字段。
- JSON 导入和导出。

V1 不包含注册登录、刷新令牌、云端上传、自动同步和多设备冲突处理。

### 2.3 V1.1：云端备份版

V1.1 增加：

- ThinkPHP 注册、登录、刷新令牌和退出登录。
- MySQL 云端存储。
- 手动上传备份和手动恢复。
- 单账号、单设备备份流程。
- 本地数据空间和账号归属选择。
- 用户自定义同步密码。
- API 密钥和系统提示词的客户端加密上传。

V1.1 定位为备份恢复，不承诺完整双向实时同步。

### 2.4 V1.2：多设备同步版

V1.2 增加：

- 增量同步游标。
- 双向同步。
- 服务端 revision 和幂等 mutation。
- 多设备冲突处理。
- tombstone 生命周期和旧设备恢复。
- 前台自动同步和 Android 后台任务。
- 同步密码轮换和云端密文重新加密。

## 3. 平台与使用边界

- 首发平台仅为 Android App。
- 本地模式无需账号，也不访问同步服务。
- 本地数据可以离线查看、搜索、管理和导出。
- 调用远程模型仍需网络；只有用户配置本机或局域网模型时，模型生成才可能离线工作。
- 模型请求由 App 直接发送到用户配置的服务，ThinkPHP 后端不代理模型请求。

## 4. 总体架构

### 4.1 Android App 分层

- UI 层：会话、聊天、接口管理、设置和账号备份。
- 应用服务层：聊天编排、上下文构造、接口配置和备份/同步调度。
- 本地数据层：SQLite、迁移器、仓储和事务。
- 模型协议层：统一 `ChatProvider` 契约和 `OpenAIProvider`。
- 传输层：`ChatTransport`，隔离 uni-app 请求和 Android 原生请求。
- 安全层：Android Keystore 本地密钥和同步密码派生的云端密钥。
- 同步层：V1.1 的备份恢复，以及 V1.2 的 Outbox、游标、revision 和冲突处理。

依赖方向：

```text
ChatService
  -> ChatProvider
       -> OpenAIProvider
            -> ChatTransport
                 -> UniRequestTransport
                 -> AndroidNativeTransport
```

网络实现不得直接写死在 `OpenAIProvider` 中。

### 4.2 云端服务

- ThinkPHP 提供 REST API。
- MySQL 保存用户、令牌、备份数据和同步元数据。
- 后端负责鉴权、用户隔离、幂等处理和服务端版本控制。
- 聊天正文和标题以明文保存；API 密钥与系统提示词只保存客户端密文。
- 该能力称为“敏感字段客户端加密”，不称为完全端到端或零知识同步。

## 5. 页面结构

底部三栏导航：

1. 会话：会话列表、搜索和进入聊天。
2. 接口：管理模型服务、测试连接和加载模型。
3. 设置：本地设置、系统提示词、导入导出，以及 V1.1 起的账号和备份。

聊天页顶部显示当前接口和模型。生成期间禁止直接切换当前请求使用的接口或模型；用户停止或请求结束后才能切换。

## 6. 模型接口配置

首版只实现 OpenAI 兼容协议，但保留协议适配器扩展点。

`provider_profiles` 至少包含：

- `id`
- `workspace_id`
- `name`
- `protocol_type`
- `auth_type`
- `base_url`
- `encrypted_api_key`
- `custom_headers_ciphertext`
- `default_model`
- `request_timeout`
- `stream_enabled`
- `models_cache`
- `last_test_status`
- `last_test_error`
- `created_at`
- `updated_at`
- `deleted_at`

基础地址只接受服务根地址或 `/v1` 地址，例如：

- `https://example.com`
- `https://example.com/v1`

V1 不允许直接填写完整的 `/chat/completions` 地址。适配器统一推导模型列表和聊天地址，并避免重复拼接 `/v1`。

## 7. 模型与传输契约

`ChatProvider` 负责：

- 测试连接。
- 获取模型列表。
- 构造协议请求。
- 将供应商响应转换为统一聊天事件。
- 将服务错误转换为统一错误类型。

`ChatTransport` 负责：

- 发起 HTTP 请求。
- 逐块返回原始字节。
- 取消请求。
- 报告网络错误和连接状态。

SSE 解析器必须支持：

- 一个分块包含多个事件。
- 一个事件跨多个分块。
- UTF-8 字符跨分块。
- `data:` 多行和空行分隔。
- `[DONE]`。
- 停止后忽略迟到分块。

## 8. 聊天消息持久化

### 8.1 消息表

`messages` 至少包含：

- `id`
- `workspace_id`
- `conversation_id`
- `sequence`
- `role`
- `content`
- `status`
- `request_id`
- `finish_reason`
- `error_code`
- `retry_of_message_id`
- `created_at`
- `updated_at`
- `deleted_at`

助手消息状态：

- `generating`
- `completed`
- `cancelled`
- `interrupted`
- `failed`

### 8.2 发送流程

1. 在同一 SQLite 事务中写入用户消息和助手占位消息。
2. 助手占位消息初始状态为 `generating`。
3. 发起模型请求并流式更新 UI。
4. 按时间间隔或累计字符阈值批量保存助手内容，不按 token 写库。
5. 正常结束改为 `completed`。
6. 用户停止改为 `cancelled`。
7. 网络中断改为 `interrupted`。
8. App 启动时将遗留的 `generating` 统一恢复为 `interrupted`。

该流程保证 App 被杀或崩溃时，已经生成的文本最多丢失一个落库间隔。

### 8.3 重试规则

重试表示为同一条用户消息重新生成助手回复，不重复插入用户消息。

```text
用户消息
  -> 助手回复 A：failed/interrupted
  -> 助手回复 B：retry_of_message_id 指向 A
```

## 9. 上下文构造

请求顺序：

1. 会话覆盖系统提示词，或全局系统提示词。
2. 截断后的历史消息。
3. 当前用户消息。

上下文必须同时限制：

- 最大历史消息数。
- 最大估算字符数或 token 数。

截断时始终保留 system 消息和最近对话，从最旧的历史消息开始移除。

助手消息进入后续上下文的默认规则：

- `completed`：进入。
- `failed`：不进入。
- 空内容 `cancelled`：不进入。
- 有内容 `interrupted`：进入，但允许用户删除或重新生成。

## 10. 系统提示词

- 设置页提供全局系统提示词开关和输入框。
- 会话可继承、关闭或覆盖全局值。
- 最终值作为 `system` 消息发送，不显示为普通聊天消息。
- 本地存储时使用 Android Keystore 保护的设备密钥加密。
- V1.1 上传时使用同步密码派生的云端密钥重新加密。

`conversations` 至少包含：

- `id`
- `workspace_id`
- `title`
- `provider_profile_id`
- `provider_name_snapshot`
- `model_name`
- `system_prompt_mode`
- `system_prompt_ciphertext`
- `last_message_at`
- `server_revision`
- `created_at`
- `updated_at`
- `deleted_at`

即使接口配置已删除，历史会话仍显示创建时的接口名称快照和模型名称。

## 11. SQLite 与迁移

App 端使用 `plus.sqlite` 或经 V0 验证后的等价实现。

增加 `schema_migrations`：

- `version`
- `applied_at`

每次启动：

1. 打开数据库。
2. 读取当前 schema 版本。
3. 按顺序执行未应用迁移。
4. 每个迁移使用事务。
5. 失败时回滚，并阻止继续启动数据层。

必须测试旧 APK 覆盖安装升级，不只测试全新安装。正式发布后不得随意修改 AppID。

## 12. 本地数据空间与账号隔离

所有业务表增加：

- `workspace_id`
- `owner_type`：`local` 或 `cloud`
- `cloud_user_id`：本地空间为空，云端空间为账号 ID

不同云端账号使用独立 workspace、同步队列和同步游标。账号 A 退出后登录账号 B 时，不得自动上传 A 或本地 workspace 的数据。

V1.1 首次登录必须让用户选择：

1. 将当前本地数据复制并合并到该云端账号。
2. 保持当前本地数据独立，并创建/打开该账号 workspace。
3. 清空该账号本地 workspace 后，仅恢复云端数据。

退出登录不会删除本地数据，但会锁定对应云端 workspace，直到原账号再次登录。

## 13. 双层加密

### 13.1 设备本地密钥

- 由 Android Keystore 生成并保护不可导出的随机密钥。
- 用于加密 SQLite 中的 API 密钥、刷新令牌、系统提示词和敏感自定义请求头。
- 不得在 JavaScript、配置文件或源码中保存固定主密钥。

### 13.2 云端同步密钥

- 用户单独设置同步密码。
- 使用 PBKDF2-HMAC-SHA256 派生云端加密密钥。
- 使用 AES-256-GCM 加密敏感字段。
- 每次加密使用唯一随机 nonce。
- 保存 KDF、盐、迭代次数、算法版本和加密校验值。
- 使用 AAD 绑定用户 ID、实体 UUID 和字段名称。

新设备恢复：

1. 输入同步密码并派生云端密钥。
2. 验证加密校验值。
3. 解密云端敏感配置。
4. 使用新设备 Android Keystore 密钥重新加密并写入 SQLite。

同步密码错误时，不得上传或覆盖任何现有密文。

修改同步密码时，必须先用旧密码解密全部云端敏感字段，再使用新密码派生的新密钥重新加密；任一步失败都不得部分提交。

## 14. V1.1 云端备份

ThinkPHP 提供：

- 注册、登录、刷新令牌和退出登录。
- 上传 workspace 备份。
- 获取备份元数据。
- 恢复备份。
- 删除云端备份和注销账号。

登录密码使用 PHP `password_hash` 和 `password_verify`。访问令牌短期有效，刷新令牌可撤销，并只以哈希形式保存在 MySQL。

V1.1 使用显式的“立即备份”和“从云端恢复”，不实现后台双向合并。

## 15. V1.2 增量同步与冲突

### 15.1 本地 Outbox

`sync_queue` 至少包含：

- `mutation_id`
- `workspace_id`
- `entity_type`
- `entity_uuid`
- `operation`
- `payload`
- `base_revision`
- `attempt_count`
- `next_retry_at`
- `locked_at`
- `last_error`
- `created_at`

业务实体写入和 Outbox 写入必须位于同一个 SQLite 事务。

### 15.2 服务端版本

每条可修改记录包含：

- `client_uuid`
- `server_revision`
- `last_mutation_id`
- `updated_by_device`
- `server_updated_at`

客户端上传 mutation：

```json
{
  "mutation_id": "唯一操作 UUID",
  "entity_id": "实体 UUID",
  "base_revision": 12,
  "operation": "update",
  "payload": {}
}
```

服务端规则：

- `mutation_id` 已处理：返回原结果，实现幂等。
- `base_revision` 等于当前 revision：应用变更并将 revision 加一。
- `base_revision` 落后：返回冲突，不静默覆盖。
- 删除同样产生新 revision 和 tombstone。

V1.2 若暂时提供“最后写入覆盖”模式，必须明确它是服务器接收顺序优先，而不是客户端 `updated_at` 优先。

### 15.3 同步调度

- App 前台运行：每 3 分钟检查一次。
- App 回到前台：立即检查。
- 网络恢复：触发一次检查。
- 用户点击“立即同步”：马上执行。
- 本地写入后：可短延迟合并触发一次同步。
- App 后台：通过 Android WorkManager 或等价原生任务尽力同步，不承诺精确 3 分钟。

同步服务必须有互斥锁，保证同一 workspace 同时最多执行一个同步任务。

## 16. JSON 导入导出

V1 提供本地 JSON 导入导出：

- 导出会话、消息、接口元数据和设置。
- API 密钥默认不导出；用户明确选择时导出加密密文和算法元数据。
- 导入前校验格式和版本。
- 导入使用事务，失败时不写入部分数据。
- UUID 冲突时提供跳过、覆盖或复制为新记录的明确策略。

## 17. 错误处理

- 模型不可达：保留用户消息和助手占位记录，标记失败并可重试。
- API 密钥无效：标记接口测试失败，不删除配置。
- 模型列表失败：允许手动输入模型名称。
- SSE 解析失败：保存已生成文本并标记 `interrupted`。
- App 被杀：下次启动恢复遗留 `generating` 状态。
- 数据库迁移失败：回滚并阻止数据层继续运行。
- 令牌过期：尝试刷新；失败后重新登录，但不删除 workspace。
- 同步密码错误：阻止敏感字段恢复和密文覆盖。
- 同步请求失败：Outbox 保留，按退避时间重试。

## 18. 测试策略

### 18.1 V0 真机传输

- 中文 UTF-8 跨分块。
- 一个分块多个 SSE 事件。
- 一个事件跨多个分块。
- `[DONE]` 和异常结束。
- 停止后仍收到延迟分块。
- 切前台/后台和锁屏。
- OpenAI、NewAPI 和至少一个兼容中转服务。

### 18.2 V1 App

- 地址规范化和 `/v1` 拼接。
- 模型列表回退到手动输入。
- 连续点击发送两次。
- 生成中切换接口或模型。
- 流式生成时强制杀掉 App。
- generating 恢复为 interrupted。
- 定期落库不丢失已生成内容。
- 停止、失败和重试的消息关系。
- 上下文截断和不同状态消息的包含规则。
- 系统提示词继承、关闭和覆盖。
- Android Keystore 加解密失败。
- SQLite 迁移成功、失败回滚和旧 APK 覆盖升级。
- JSON 导入事务和 UUID 冲突。

### 18.3 V1.1 备份

- 注册、登录、刷新、退出和撤销令牌。
- 用户 A 退出后登录用户 B，不发生 workspace 串联。
- 三种首次登录数据归属选择。
- 备份中断和恢复中断。
- 错误同步密码不覆盖密文。
- 新设备恢复后使用新 Keystore 密钥重新加密。
- 修改同步密码的完整重新加密和事务回滚。

### 18.4 V1.2 同步

- 同一账号同时触发多个同步任务。
- 服务端已处理 mutation，但客户端收确认前断网。
- 同一 `mutation_id` 重复上传十次。
- 两设备同时修改同一会话。
- 删除与修改冲突。
- tombstone 已清理后旧设备重新上线。
- `sync_changes` 游标过期后的全量恢复。
- 后台任务被系统延迟或终止。

## 19. 验收里程碑

### V0 完成

- 已生成 Android APK 并通过真机 SSE 与停止测试。
- 已确定并封装最终 `ChatTransport`。

### V1 完成

- 用户可配置多个接口并完成可靠流式对话。
- App 被杀后已生成内容可恢复。
- 会话、系统提示词、本地加密和导入导出可用。

### V1.1 完成

- 用户可注册登录、手动备份并在新设备恢复。
- 不同账号数据严格隔离。
- 敏感字段以客户端密文存入 MySQL。

### V1.2 完成

- 多设备双向增量同步可用。
- mutation 幂等、revision 冲突和 tombstone 流程通过测试。
- 前台自动同步和后台尽力同步均不产生并发任务。

## 20. 非目标

- iOS、H5 和小程序发布。
- 图片、语音、文件和多模态输入。
- 团队空间、会话分享和多人协作。
- 服务端代理模型请求或统一计费。
- V1 实现 Claude、Gemini 等非 OpenAI 协议。
- 将明文聊天历史描述为零知识或完整端到端加密。
