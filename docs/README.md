# 文档导航

当前发布版本为 **1.1.1 / Android 版本码 111**。了解应用功能与预览先看 [项目自述文件](../README.md)，按版本查看变化请看 [更新日志](../CHANGELOG.md)。

## 当前实现与维护

| 文档 | 内容 |
| --- | --- |
| [技术概览](technical-overview.md) | 当前架构、五个主导航、13 个设置详情视图、聊天与故事阅读、流式滚动、Android 代理、数据与加密边界，以及发布验收。 |
| [云端增量同步 v1](cloud-incremental-sync-v1.md) | 已实现的同步协议、设备设置隔离、凭证处理、密文备份与 JSON 分享区别、004–007 迁移及部署顺序。 |
| [角色卡导入 PoC](character-card-import-poc.md) | 角色卡格式验证与早期导入验证记录；阅读时结合当前 [导入实现](../src/features/character-import) 核对，不作为全应用现状说明。 |

## 历史设计与计划

[superpowers/specs](superpowers/specs) 与 [superpowers/plans](superpowers/plans) 保存早期设计、方案与实施计划，用于理解当时的决策背景。它们可能包含已被后续迭代替换的页面数量、组件结构或待办项，不代表当前功能已实现或仍待实施。

维护当前说明时优先更新本目录的技术概览、协议文档与根目录更新日志；保留历史计划原文，避免把当时的设计意图误写成今天的实现证据。
