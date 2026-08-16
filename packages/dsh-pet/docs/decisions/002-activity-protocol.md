# ADR 002：桌宠活动与通信协议

## 状态

Fork 原型已接受，日期为 2026-08-16。

## 上下文

桌面窗口运行在独立 Electron 进程，不能直接持有 Cordis Context 或 Session 对象。通信还必须在 Harness 重启、流中断和旧 Host 版本下可靠降级，并避免把用户输入、模型输出或本地路径暴露给渲染器。

## 决策

### Host 投影

- Host 只使用官方 Session Event 构造活动状态，不依赖 DSH 源码 checkout 或第三方活动插件。
- 每个任务用 `instanceId`、`bootId` 和 `sessionId` 组合标识；注册表用单调 `sequence` 生成完整快照。
- 阶段限定为 `idle`、`waiting`、`thinking`、`tool`、`review`、`waiting_input`、`done` 和 `failed`。
- 主任务、工具安全名称和宠物文案由纯 TypeScript Core 决定，桌面渲染器只消费 `PetIntent` 与兼容动画字段。

### 传输

- 桌面端仅接受用户配置的 loopback HTTP/HTTPS 根地址。
- `/api/pet/events` 使用 SSE 推送完整状态并定期发送空 heartbeat；连接成功后停止兼容轮询。
- SSE 不可用时，桌面端以低频 `/api/pet/state` 轮询并退避重连。
- 互动与窗口设置通过有界 JSON POST 路由提交；请求体、枚举值和布尔字段在 Host 端再次校验。
- Electron renderer 开启 sandbox 与 context isolation，只能通过经过校验的 preload IPC 调用主进程。

### 隐私与容量

- 活动文本会限制长度、清理控制字符、缩写路径、移除 URL 查询参数并脱敏常见凭据模式。
- 不发送完整用户输入、模型输出、文件内容、工具原始结果、环境变量或凭据。
- SSE 解码缓冲和 POST 请求体均有 64 KiB 上限，异常数据不会无限累积。

### 性能

- 稳态只保留一条 SSE 连接，不进行周期状态请求。
- 精灵动画按实际帧时长定时，窗口隐藏时停止计时，不使用持续的 30/60 FPS 重绘循环。
- 拖动轮询只在按住桌宠期间存在；位置保存防抖，亲密度数据只在经济状态变化时写盘。

## 结果

桌面进程与 Harness 之间保持可测试、渲染器无关的窄接口。当前不提供桌面版或 CLI Harness Adapter，也不对远程地址开放桥接；这些属于后续独立设计范围。
