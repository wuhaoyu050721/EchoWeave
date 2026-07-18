# 浏览器本地聊天版设计规格

## 1. 目标

在现有 uni-app Vue 3 Version C 界面上实现可真实使用的浏览器本地聊天功能，同时保持当前四个页面的布局、导航位置和信息密度不变。

本阶段使用浏览器平台能力完成 OpenAI 兼容接口、流式聊天、本地持久化和敏感字段加密。代码必须通过平台适配接口隔离浏览器实现，以便 Android 阶段替换为 `uni.request`、`plus.sqlite` 和 Android Keystore，而不重写聊天业务逻辑。

## 2. 范围

本阶段包含：

- OpenAI 兼容接口的新增、编辑、删除、选择和连接测试。
- 从 `/models` 获取模型列表，并允许手动填写模型名称。
- SSE 流式聊天、停止生成和重试。
- 新建、搜索、重命名和删除会话。
- IndexedDB 持久化接口、会话、消息和设置。
- Web Crypto AES-GCM 加密 API 密钥和系统提示词。
- 全局系统提示词开关和输入框，每次请求自动发送最终系统提示词。
- JSON 导入和导出。
- 仅供本机开发预览使用的 Vite HTTP 转发代理。

本阶段不包含：

- Android APK、`plus.sqlite`、Android Keystore 或真机 SSE 验证。
- PHP、MySQL、注册登录、云端备份或多设备同步。
- 非 OpenAI 协议适配器。
- 图片、文件、语音或其他多模态输入。

## 3. 架构

```text
Vue UI
  -> ChatService
       -> ChatProvider
            -> OpenAIProvider
                 -> ChatTransport
                      -> BrowserFetchTransport
       -> AppRepository
            -> IndexedDbRepository
       -> SecretVault
            -> WebCryptoVault
```

### 3.1 UI 层

`pages/index/index.vue` 只负责呈现状态和转发用户操作。当前会话列表、聊天页、接口页和设置页的整体布局不调整，静态演示数据改为仓储返回的真实数据。

UI 不直接调用 `fetch`、IndexedDB 或 Web Crypto。

### 3.2 应用服务层

`ChatService` 负责：

- 创建用户消息和助手占位消息。
- 构造对话上下文。
- 调用当前协议适配器。
- 将流式增量写入 UI，并按批次持久化。
- 完成、停止、失败和中断状态转换。
- 按同一用户消息创建重试回复，不重复插入用户消息。

`ProviderService` 负责接口配置验证、敏感字段加解密、连接测试和模型列表加载。

### 3.3 协议层

`ChatProvider` 提供统一契约：

- `testConnection(profile)`
- `listModels(profile)`
- `streamChat(profile, request, handlers)`

`OpenAIProvider` 规范化基础地址，并派生：

- 模型地址：`{baseUrl}/models`
- 聊天地址：`{baseUrl}/chat/completions`

基础地址只接受服务根地址或以 `/v1` 结尾的地址。若用户填写根地址，自动补充 `/v1`；拒绝完整的 `/chat/completions` 地址。

### 3.4 传输层

`BrowserFetchTransport` 使用 Fetch API 和 `ReadableStream` 接收响应字节，支持 `AbortController` 停止请求。

开发预览通过 `/__ai_proxy` 转发请求。客户端发送目标地址和必要请求信息，Vite 中间件只允许 `http` 或 `https` 目标，不记录 API 密钥，不向浏览器之外暴露监听地址。Android 阶段不使用该代理。

### 3.5 数据层

`IndexedDbRepository` 使用单一数据库和版本化迁移。对象仓库包括：

- `meta`
- `providers`
- `conversations`
- `messages`
- `settings`
- `secrets`

所有业务实体使用 UUID。删除采用当前阶段的直接删除；为 Android 和同步阶段预留 `deletedAt` 字段，但本阶段不实现 tombstone 同步。

### 3.6 安全层

首次启动时使用 Web Crypto 生成不可导出的 AES-GCM 设备密钥，并以浏览器可持久化的 `CryptoKey` 保存于 IndexedDB `secrets` 仓库。

每次加密使用新的 96 位随机 IV。密文记录保存算法版本、IV 和 ciphertext。API 密钥及系统提示词不得以明文写入 IndexedDB、日志、测试快照或导出文件。

此方案用于浏览器开发阶段的本地保护，不宣称等同于 Android Keystore。能够在相同浏览器配置中解密，但无法防御已获得同源脚本执行权的攻击者。

## 4. 数据模型

### 4.1 ProviderProfile

```text
id
name
protocolType
baseUrl
encryptedApiKey
defaultModel
modelsCache
requestTimeout
streamEnabled
lastTestStatus
lastTestError
createdAt
updatedAt
deletedAt
```

### 4.2 Conversation

```text
id
title
providerProfileId
providerNameSnapshot
modelName
systemPromptMode
encryptedSystemPrompt
lastMessageAt
createdAt
updatedAt
deletedAt
```

`systemPromptMode` 为 `inherit`、`disabled` 或 `override`。本阶段 UI 默认使用 `inherit`，数据层保留三种模式。

### 4.3 Message

```text
id
conversationId
sequence
role
content
status
requestId
finishReason
errorCode
retryOfMessageId
createdAt
updatedAt
deletedAt
```

助手消息状态为 `generating`、`completed`、`cancelled`、`interrupted` 或 `failed`。

## 5. 聊天流程

1. 禁止在已有请求生成时再次发送。
2. 持久化用户消息和 `generating` 助手占位消息。
3. 将当前用户消息立即显示在 UI。
4. 解密接口密钥和最终系统提示词。
5. 构造有限上下文并发起流式请求。
6. SSE 增量实时更新助手消息。
7. 每 500 毫秒或累计 200 个新字符时持久化一次，以先达到的条件为准。
8. 收到 `[DONE]` 或正常结束时保存为 `completed`。
9. 用户停止时保存已有文本并标记为 `cancelled`。
10. 网络或解析异常时保存已有文本；有内容标记为 `interrupted`，无内容标记为 `failed`。
11. 启动时将遗留的 `generating` 消息改为 `interrupted`。

上下文最多包含最近 40 条符合条件的消息，并限制为约 60,000 个字符。始终保留最终系统提示词和最新消息，从最旧消息开始截断。

## 6. SSE 解析

解析器按字节流工作，并使用流式 `TextDecoder` 处理中文字符跨分块场景。必须支持：

- 一个网络分块包含多个 SSE 事件。
- 一个 SSE 事件跨多个网络分块。
- 多行 `data:`。
- CRLF 和 LF 换行。
- `[DONE]`。
- JSON 增量中的 `choices[0].delta.content`。
- 停止后忽略迟到数据。

协议错误转换为统一错误对象，UI 只显示经过整理的错误消息，不展示 API 密钥或完整请求头。

## 7. 接口与模型

保存接口前验证：

- 名称非空。
- 基础地址为 `http` 或 `https`。
- 地址不包含查询参数、片段或 `/chat/completions`。
- API 密钥允许为空，以支持不鉴权的本地兼容服务。
- 默认模型非空。

连接测试优先请求 `/models`。请求成功且返回列表时缓存模型；请求成功但没有标准列表时仍允许保存接口并手动填写模型。401/403 显示密钥或权限错误，超时和网络错误显示可执行的排查信息。

## 8. 会话操作

- 新建会话使用当前接口和默认模型，并生成“新对话”标题。
- 首条用户消息发送后，若标题仍为“新对话”，使用消息前 24 个字符生成标题。
- 搜索匹配会话标题和最后一条消息摘要。
- 重命名和删除从会话行的更多菜单进入。
- 删除会话同时删除其消息。

## 9. 系统提示词

设置页保留系统提示词开关和输入框。开关关闭时不向模型发送系统消息；开启时解密全局提示词并作为第一条 `system` 消息发送。

保存时立即加密，不在响应式状态之外长期保留明文。导出默认不包含系统提示词明文。

## 10. JSON 导入导出

导出格式包含 `formatVersion: 1`、导出时间、接口元数据、会话、消息和非敏感设置。

默认排除 API 密钥和系统提示词。浏览器阶段不提供可跨设备恢复的加密密钥，因此也不导出无法在其他浏览器解密的本地密文。

导入前完整校验格式。导入采用先校验、后写入策略；发现不支持的版本或非法实体时不写入任何记录。UUID 冲突默认复制为新记录，并重映射会话与消息关系。

## 11. 错误与状态

- 未配置接口：发送按钮不可用并引导到接口页。
- 接口不可达：保留用户消息和失败占位，可重试。
- CORS 或代理失败：提示当前为浏览器预览代理问题。
- API 密钥无效：保留配置并记录最近测试错误。
- 模型列表失败：保留手动模型输入。
- 页面刷新：恢复会话，遗留生成消息标记为中断。
- IndexedDB 或加密初始化失败：阻止敏感字段保存，并显示明确错误。

## 12. 测试与验收

自动化测试至少覆盖：

- 基础地址规范化和非法地址拒绝。
- SSE 跨分块、多事件、多行、中文和 `[DONE]`。
- 上下文状态过滤和截断。
- 发送、停止、失败和重试状态转换。
- API 密钥加密记录不包含明文，且可以解密。
- JSON 导入版本校验和 UUID 重映射。
- UI 中新增接口、发送消息、停止、搜索和刷新恢复。

浏览器验收：

- 用户可填写任意 OpenAI 兼容服务的基础地址、密钥和模型。
- 连接测试与模型列表真实请求可用。
- 回复按流式内容增长，停止后不再追加迟到数据。
- 刷新页面后接口、会话、消息和设置仍存在。
- IndexedDB 中看不到 API 密钥和系统提示词明文。
- 四个页面的布局与当前 Version C 保持一致。

## 13. Android 迁移边界

Android 阶段保留 `ChatService`、`OpenAIProvider`、SSE 解析、上下文构造和数据模型，只替换：

- `BrowserFetchTransport` -> `UniRequestTransport` 或 `AndroidNativeTransport`
- `IndexedDbRepository` -> `SQLiteRepository`
- `WebCryptoVault` -> `KeystoreVault`
- Vite 开发代理 -> App 直接请求目标服务

在 Android 真机验证完成前，不宣称浏览器流式结果能代表 `uni.request` 的实际行为。
