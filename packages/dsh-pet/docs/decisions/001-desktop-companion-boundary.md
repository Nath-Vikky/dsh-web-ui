# ADR 001：桌面伴生端边界

## 状态

Fork 原型已接受，日期为 2026-08-15。

## 上下文

`dsh-pet` 同时拥有 Host 状态、Web API、浏览器全局挂载、精灵图渲染、互动账本和持久化；把 Electron 与 Live2D 发布链直接并入现有 npm 包会让 DSH 插件安装承担桌面二进制、平台签名和模型许可成本，也会削弱当前 Web 宠物的可靠降级路径。

## 决策

- `@linxin666/dsh-pet` 继续是 DSH Host 与 Web 客户端插件，不依赖 Electron 才能运行。
- 当前精灵图实现保留为正式的 `sprite` 渲染模式，用户可以长期使用，并可在其他渲染器失败时降级到该模式。
- 活动投影、主任务选择、文案调度、宠物意图和通信类型进入不依赖 DOM、WebServer、React 或 Electron 的纯 TypeScript Core。
- Web 客户端通过渲染器接口消费宠物意图；Live2D 是可选的 `live2d` 渲染模式，不直接读取 DSH Session Event。
- 桌面伴生端采用独立发布单元，负责透明窗口、托盘、启动器、桌面 Bridge 服务和桌面渲染生命周期。
- DSH Host 通过可选 Adapter 连接桌面 Bridge；桌面程序未运行、Bridge 不可用或协议不兼容时，DSH 与 Web 宠物继续正常工作。
- Fork 原型完成验证前不创建上游 PR；可合入范围在演示、性能数据和兼容证据齐备后再与维护者讨论。

## 兼容约束

- `/api/pet/state`、互动和显示配置端点在协议迁移期保持可用。
- 当前 `pet.json` 持久化数据继续可读，新增配置使用版本化迁移。
- `sprite` 保持默认可用且无需 GPU 模型资源，切换渲染模式不得清除亲密度、饲料、名称或位置。
- Host 活动核心不把 `webServer`、桌面 Bridge、Live2D 或第三方活动插件设为硬依赖。

## 结果

该边界增加一个共享协议和独立桌面发布单元，但把 Electron、Live2D 和平台差异隔离在 DSH 插件之外；Core 与精灵模式成为 Web、桌面和测试共同依赖的稳定层。
