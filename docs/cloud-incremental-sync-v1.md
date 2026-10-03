# 云端增量同步 v1

本文对应 **EchoWeave 1.1.1** 的当前实现。架构入口见 [技术概览](technical-overview.md)，客户端组装见 [create-cloud-services.js](../src/app/create-cloud-services.js)，服务端实现见 [CloudBackupApp.php](../server/src/CloudBackupApp.php)。本文说明协议与部署要求，不代表实际服务器已完成升级。

## 数据通道与范围

增量同步与原有的密文完整备份共存，以下完整备份路由保持不变：

- `PUT /api/v1/backup`
- `GET /api/v1/backup`
- `GET /api/v1/backup/meta`
- `DELETE /api/v1/backup`

增量同步覆盖 `providers`、`conversations`、`messages`、`attachments`、`characters`、`worldBooks`、`characterAssets` 和可迁移的业务 `settings`。JSON 分享是另外一组明文接口，其访问规则见下文“JSON 分享边界”。不要将“备份已加密”套用于 JSON 分享链接。

### 本机设置隔离

[local-settings.js](../src/core/local-settings.js) 统一排除以下设置：

| 设置键 | 不随其他设备覆盖的内容 |
| --- | --- |
| `app`、`appLock`、`appLockEnabled` | 应用锁开关、PIN 验证记录，以及包含这些字段的本机应用设置记录。 |
| `cloudDeviceId` | 本机同步设备标识。 |
| `cloudAutoBackup` | 本机自动同步/备份配置。 |
| `cloudConfig` | 本机云端连接配置。 |
| `networkProxy` | 本机代理开关、模式和地址。 |

[CloudSyncRepositoryAdapter](../src/services/cloud-sync-repository-adapter.js) 在读取待同步记录和应用远端记录时均过滤这些键；即使旧客户端已经上传，也不会在当前客户端应用。便携备份与云端完整备份的导出和导入也使用相同过滤规则。`app` 整条记录保持本机，以免只过滤开关却把内部 PIN 记录带到其他设备。

本地工作区和每个云账号工作区分别存储业务数据，账号工作区标识由服务域和不可变的账号 ID 派生。登录令牌存于独立设备数据库；同步密码由当前工作区 vault 加密后保存在 secret 存储中。这里的“本机设置”是迁移边界，不意味着表中所有设置都位于独立设备数据库。

## 认证、令牌与账号切换

推送和拉取都使用 bearer access token，由 [CloudApiClient](../src/services/cloud-api-client.js) 处理刷新：

- 普通鉴权请求遇到 401 时，如果存在刷新令牌，刷新后最多重试一次；同一客户端上的并发刷新复用同一任务。
- 临时断网、429 限流或服务器 5xx 不会清空刷新凭证。刷新接口明确返回 401 时，才清除仍属于原会话的本地凭证；主动退出则清除仍匹配的原会话。
- 发起鉴权请求、刷新和退出前验证账号与服务器归属。会话更换后，旧客户端不能覆盖或清空新账号凭证，会返回 `cloud_session_changed` 等归属错误。
- 完整备份与 JSON 传输设置 10 分钟超时；上传等大型操作前检查访问令牌是否即将在传输期间到期，必要时先刷新。此超时不等于后台执行保证，也不改变增量推送的批量大小限制。

加密凭证实现见 [CloudTokenStore](../src/services/cloud-token-store.js) 与 [CloudSyncCredentialStore](../src/services/cloud-sync-credential-store.js)。同步密码至少 12 个字符，当前不支持直接更换已有的增量同步密码；更换密码并不会自动重加密服务器上的旧记录。

## 传输协议

### 推送

`POST /api/v1/sync/push`

```json
{
  "protocol_version": 1,
  "device_id": "device-a",
  "mutations": [
    {
      "mutation_id": "b82c1f2e-2c9f-49de-812c-12a2e07458c4",
      "entity_type": "messages",
      "entity_id": "message-1",
      "operation": "upsert",
      "updated_at_ms": 1800000000000,
      "envelope": {}
    }
  ]
}
```

示例的 `envelope` 是占位符，实际请求必须包含有效加密信封。服务器为每个首次出现的 mutation 分配用户范围内单调递增的 revision，包括在冲突比较中落败的 mutation。在幂等回执尚未清理时，重复提交内容相同的 `mutation_id` 返回原回执，不新增 revision；相同 ID 对应不同内容则返回 `409 mutation_id_reused`。

每个结果都返回当前规范记录 `record`，即使提交内容落败也是如此。因此客户端的拉取游标已经越过该记录 revision 时，仍能通过推送结果收敛。重复提交的回执保留原 `accepted` 与 mutation revision，但 `record` 是当前最新规范记录。

服务端默认保留幂等回执 180 天（`sync_mutation_retention`），在后续推送时清理；超过保留期不承诺仍能返回原 mutation 回执。客户端正常重试应复用已保存的 mutation ID 和密文，不能把超时简单改成一个新操作。

### 拉取

`POST /api/v1/sync/pull`

```json
{
  "protocol_version": 1,
  "cursor": 0,
  "limit": 100
}
```

返回 `changes`、`next_cursor`、`has_more` 和 `server_cursor`。服务器在事务中先读取 revision 上界，再按游标分页。最后一页可能跨过被拒绝 mutation 占用的 revision；此时 `next_cursor` 前进到事务上界，而不会伪造变更行。游标超过服务器上界时返回 `409 sync_cursor_ahead`。

每次写入同一实体的新规范记录时，服务端会删除其较旧的 `sync_changes` 行。拉取提供最新状态收敛所需的变更，不是可永久重放每一次编辑的审计日志。

## 加密与服务器可见信息

每条 upsert 和删除墓碑都具有独立 AES-GCM 信封与随机 96 位 IV。PBKDF2-SHA-256 使用 210,000 次迭代和 128 位盐；同一设备可复用自己的 KDF 盐，以便一次同步期间缓存派生密钥，但各条记录仍能独立认证和解密。

AES-GCM 附加认证数据绑定协议版本、实体类型、实体 ID、操作与 `updated_at_ms`，不能把信封挪到其他记录，或将 upsert 改成 delete 而不触发认证失败。实现见 [cloud-sync-crypto.js](../src/core/cloud-sync-crypto.js) 和 [cloud-sync-protocol.js](../src/core/cloud-sync-protocol.js)。

**对于密文备份和增量同步接口**，服务器可见账号、实体类型、不透明实体 ID、操作、客户端时间、设备 ID、大小、revision 和密文，不接收记录的业务明文或本地明文哈希。接口密钥与加密提示词只在源设备内存中解密，再放入同步信封；目标设备在导入前使用自己的 vault 重新加密。这项保证不适用于下面的明文 JSON 分享接口。

## 本地清单与删除

[CloudSyncStateStore](../src/services/cloud-sync-state-store.js) 按账号保存：

- 上次拉取游标。
- 每条记录的明文哈希、规范 revision、时间戳、墓碑状态和最小关联引用。
- 待提交 mutation ID 及已经加密的信封。
- 设备的同步 KDF 盐。

同步状态不包含同步密码或业务明文。扫描将本地规范化哈希与清单比较；已知记录在本地物理消失后生成加密墓碑。最小关联引用让 SQLite 能为要求非空父级字段的实体保存过滤后的墓碑行。

设置仓储没有通用删除方法：接收的设置墓碑以 `null` 保存；对应清单条目移除后，适配器将其视为不存在，而不是再次产生 upsert。本机设置在扫描和应用两端提前跳过。

头像等角色资源支持通过本地 revision 和已缓存哈希识别未变化记录，不需要每轮重新读取并散列全部大型 Base64 数据，见 [CloudSyncRepositoryAdapter](../src/services/cloud-sync-repository-adapter.js)。

## 冲突顺序

服务端按下列元组比较，数值或字典序更高者获胜：

1. `updated_at_ms`
2. 墓碑优先级（相同时间戳时 `delete` 胜出）
3. 服务端分配的 revision
4. 设备 ID 字典序

较旧或同时间戳的 upsert 不能复活墓碑；严格更新的 upsert 视为后续编辑，可重新创建记录。这不是逐字段合并算法，冲突单位为整条实体记录。

## 大小与请求限制

默认服务端参数见 [config.example.php](../server/config.example.php)，实际值由部署环境的配置决定：

| 限制 | 默认值 |
| --- | --- |
| 一次同步推送 | 48 MiB |
| 单条加密记录 | 40 MiB |
| 拉取响应字节预算 | 48 MiB；若单条记录大于预算，单独返回 |
| 每次推送 mutation 数 | 100 |
| 每页最多拉取记录数 | 500 |
| 完整备份与服务端 JSON 单份大小 | 100 MiB |
| 便携 JSON 导出、Android 原生本地 JSON 导入 | 50 MiB |

客户端的 50 MiB 校验只覆盖上述导出及 Android 原生本地文件读取路径；浏览器本地 JSON 导入与云端链接导入目前没有同一客户端大小校验。服务端 JSON 分享仍受服务器配置的单份大小和账号配额限制。

多记录推送因体积被拒绝时，客户端将批次减半重试并保留原 mutation ID；单条仍过大则报告 `sync_record_too_large`。前置控制器限制读取请求体字节，`CloudBackupApp` 在解码后继续检查具体接口的大小、数量与分页预算。

## 客户端组装与调度

[create-cloud-services.js](../src/app/create-cloud-services.js) 依次组装仓储适配器、同步状态仓库、同步引擎与协调器；[cloud-settings-methods.js](../src/app/cloud-settings-methods.js) 负责登录后的页面操作和工作区切换。主要入口：

| 调用 | 作用 |
| --- | --- |
| `syncCoordinator.startForeground()` | 启动前台 JS 定时器并立即同步，默认间隔三分钟。 |
| `syncCoordinator.stopForeground()` | 停止前台定时器。 |
| `syncCoordinator.onAppShow()` | 应用回到前台时触发。 |
| `syncCoordinator.onNetworkRestored()` | 网络恢复时触发。 |
| `syncCoordinator.manualSync()` | 用户显式发起同步。 |
| `androidWorkManagerSyncAdapter.run()` | 供原生后台工作桥接调用的无 UI 入口。 |

[AndroidWorkManagerSyncAdapter](../src/services/android-workmanager-sync-adapter.js) 本身不调度 WorkManager，也不保证进程结束后 JS 存活。真正后台执行仍需原生模块调度任务、初始化受支持的无界面 JS 运行时并调用 `run()`；当前不能把前台定时同步描述成杀进程后仍必达的后台同步。

## JSON 分享边界

JSON 分享上传的是经过便携格式过滤的明文数据，不要求下载者输入同步密码，也不要求下载者登录。客户端会过滤接口密钥、系统提示词等指定敏感字段和本机设置，但聊天正文、角色资料、世界书、附件仍可读取；用户自己写入正文中的秘密不会被语义识别并自动删除。

| 接口 | 访问与结果 |
| --- | --- |
| `POST /api/v1/json-exports` | 需登录；创建分享，返回 ID、下载链接、大小、格式版本、创建和到期时间。 |
| `GET /api/v1/json-exports` | 需登录；仅列出当前账号未过期分享的元数据。 |
| `DELETE /api/v1/json-exports/{id}` | 需登录且拥有该记录；删除记录使链接失效，成功返回 204。 |
| `GET /api/v1/json-exports/{token}` | 持有效链接即可下载；过期、撤销或不存在均返回 404。 |

默认 `json_export_ttl=604800`（七天），每个账号最多 20 条、合计 500 MiB。上传和列表会清理过期记录；下载本身也检查过期时间，无需等清理任务执行后才阻止访问。配额检查与插入在事务中进行，MySQL 下锁定用户行以串行化同账号的并发上传。

服务端只存随机下载 token 的哈希，因此列表不能重新生成原下载链接；链接在创建时返回。客户端只接受当前云服务器生成且 token 形态有效的链接。服务端还会剥离旧客户端上传的本机设置，避免旧格式把 PIN 或代理地址一并分享。

## 部署与升级

1. 备份 MySQL 数据库和现有服务配置，核对已执行的迁移；迁移不是可重复运行的脚本，不要盲目重跑已有结构变更。
2. 在 001–003 已完成的基础上，执行尚未应用的 [004_incremental_sync.sql](../server/migrations/004_incremental_sync.sql)。
3. 执行 [005_expand_sync_envelopes.sql](../server/migrations/005_expand_sync_envelopes.sql)，让现有 20 MiB 角色资源经 Data URL 与加密编码后仍可容纳。
4. 执行 [006_auth_limits_and_sync_compaction.sql](../server/migrations/006_auth_limits_and_sync_compaction.sql)，增加认证限流存储和同步回执清理索引。
5. **在部署新的 JSON 分享管理代码之前执行 [007_expiring_json_exports.sql](../server/migrations/007_expiring_json_exports.sql)**。该迁移新增 `expires_at` 及索引，并为已有链接设置从迁移执行时开始的最后七天有效期。
6. 部署新的 PHP 服务、前置控制器及配置，将示例中的新增限制合并到实际配置并保留数据库凭证。确认反向代理、PHP 与数据库容量允许业务需要的请求体；48 MiB 只覆盖同步推送，完整备份还需要匹配更高限制。
7. 在部署环境验证注册/登录、限流、令牌刷新、旧 `/api/v1/backup` 路由，再验证空拉取、加密推送、幂等重放、冲突、分页和大型资源。
8. 验证 JSON 分享创建、个人列表、跨账号拒绝撤销、本人撤销、到期后返回 404，以及数量和容量上限。
9. 验证后发布客户端。只更新 APK 不会替服务器完成迁移或更新 PHP。

旧客户端仍可使用完整备份接口，但 JSON 分享链接的到期规则由升级后的服务器执行。数据库增加的同步表无需因回退客户端而删除。若回退服务器，不能机械地恢复旧 JSON 下载实现：旧代码可能忽略 `expires_at`，重新开放已过期链接，回退方案必须继续维持到期和撤销语义。

## 验证边界

[CI](../.github/workflows/ci.yml) 中的 PHP 测试覆盖 [路径加载](../server/tests/bootstrap-paths.php)、[基础备份](../server/tests/integration.php)、[JSON 分享安全](../server/tests/json-export-security.php) 和 [增量同步](../server/tests/sync-integration.php)。这些测试使用 PDO SQLite；生产 MySQL 的迁移状态、实际请求体限制与已部署版本仍需现场核对。

浏览器测试能够验证客户端状态和可模拟的协议响应，但不能证明 Android Keystore、原生网络、后台桥接或最终 APK 已在真机通过。发布验收应分别记录自动化结果、最终安装包的真机结果和实际服务端部署结果。
