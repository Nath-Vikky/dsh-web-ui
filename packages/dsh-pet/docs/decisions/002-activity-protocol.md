# ADR 002：活动快照协议

## 状态

Fork 原型已接受，日期为 2026-08-15；字段可在实现阶段收紧，但版本 1 的边界和隐私原则保持稳定。

## 上下文

当前 `PetStateView` 面向一个 Host 全局 Web 宠物，只表达最近一次有效活动；桌面伴生端需要合并多个 DSH 实例和会话，同时必须处理进程重启、会话 ID 重复、消息乱序、断连和最小信息披露。

## 决策

### 身份与顺序

- 每个 DSH 进程生成稳定到本次启动结束的 `instanceId` 与随机 `bootId`。
- 会话任务的跨实例身份是 `instanceId`、`bootId` 与 `sessionId` 的组合，不假定不同 Profile 的 Session ID 唯一。
- `sequence` 在一个 `bootId` 内单调递增；接收端拒绝同一启动周期内倒退的快照，新 `bootId` 会重置序号判断。
- Profile、进程启动时间和可选工作区显示名属于实例元数据，不进入任务 ID。

### 版本 1 消息

版本 1 只定义 `hello`、`snapshot`、`heartbeat` 和 `goodbye`；状态变化发送完整快照，不在首版引入 Delta 重放协议。

```ts
interface PetActivityEnvelope<T> {
  protocolVersion: 1
  type: 'hello' | 'snapshot' | 'heartbeat' | 'goodbye'
  instanceId: string
  bootId: string
  sequence: number
  emittedAt: number
  payload: T
}
```

完整快照包含任务列表、确定性主任务 ID 和聚合计数；单条编码后的消息以 16KB 为目标上限，超过上限时先截断可选文案和安全详情，不丢失身份、阶段和时间字段。

### 任务语义

任务阶段使用有限集合 `idle`、`waiting`、`thinking`、`tool`、`review`、`waiting_input`、`done` 与 `failed`；`offline` 是接收端根据心跳推导的实例状态，不由活动投影伪装成任务阶段。

任务快照只表达已知事实：阶段、阶段开始时间、最后更新时间、工具安全名称、活动工具数、完成工具数、明确来源提供的标题和耗时；没有可信来源时不生成百分比、剩余时间或完成度。

### 隐私

默认 `minimal` 级别不发送完整用户输入、模型输出、文件内容、工具原始结果、环境变量、凭据或带查询参数的 URL；标题和工具详情必须经过长度限制、控制字符清理、路径缩写、URL 参数移除和凭据模式脱敏。

### 传输与兼容

- Web 端继续以 `/api/pet/state` 作为首次同步和回退接口，后续事件流只改变传输时机，不改变当前精灵模式的状态来源。
- Desktop Bridge 只绑定 loopback，使用随机端口、随机令牌和受当前用户保护的发现文件；PID 检查只用于清理陈旧发现记录，不作为身份认证。
- 桌面端未运行时 Host Adapter 低频退避且不阻塞 Agent，不把连接失败写入会话日志。
- `dsh-working-activity` 只能作为可选增强输入；官方 Session Event 始终能独立生成基础快照。

## 结果

完整快照让首版重连与多实例合并保持简单，并为将来的 Delta 协议保留版本升级空间；复合身份、启动周期和最小信息规则避免跨 Profile 混淆、乱序回滚和默认隐私泄露。
