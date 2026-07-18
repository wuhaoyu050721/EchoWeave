# EchoWeave 织语

<p align="center">
  <img src="static/zhiyu-logo.png" width="128" alt="EchoWeave 织语 Logo">
</p>

织语是一款本地优先的自定义 AI 角色对话应用，基于 Vue 3 和 uni-app 构建，可在浏览器中预览并打包为 Android 应用。

## 主要功能

- OpenAI 兼容接口与 Gemini 原生协议
- 流式对话、图片生成与多模态附件
- SillyTavern V1/V2/V3 角色卡导入与导出
- 世界书、角色资料与对话历史管理
- IndexedDB / Android SQLite 本地存储
- 设备级密钥保护、加密云备份与增量同步
- Android 原生文件选择、导出和流式请求适配

## 本地开发

```bash
npm install
npm run dev
```

默认预览地址由 Vite 在启动时输出。

## 验证

```bash
npm test
npm run build
```

## Android 打包

1. 使用 HBuilderX 打开项目根目录。
2. 通过“运行”连接模拟器或真机调试。
3. 通过“发行 -> 原生 App-云打包”生成安装包。

应用图标和 Android 开屏资源位于 `unpackage/res/`，并已在 `manifest.json` 中配置。

## 安全说明

仓库不包含 API 密钥、云端账号令牌或签名证书。模型接口和云同步凭据需在应用内单独配置。
