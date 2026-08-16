# dsh-pet — 桌面宠物伴侣

[English](README.md) | 中文

`dsh-pet` 是能够感知 DeepSeek Harness 任务状态的桌面宠物。Host 插件把官方会话活动投影为宠物意图，Electron 应用则在透明桌面窗口中渲染用户选择的像素模型。

原来的网页内鲸鱼娘浮层已经移除。安装本插件后，DSH 网页不再挂载浮动宠物、召唤按钮、精灵传输或素材路由；浏览器客户端只负责提供桌面宠物设置卡。

## 功能

| 功能 | 说明 |
|---|---|
| 桌面窗口 | Electron 透明窗口、系统托盘、顺滑拖动、位置持久化、位置锁定和窗口置顶 |
| 任务感知 | DSH 官方会话事件驱动等待、工作、工具、复盘、完成、失败和待机动画 |
| 互动 | 摸头和喂食会更新亲密度、小鱼干库存与反馈 |
| 像素模型 | 内置鲸鱼娘可靠回退、本地 PetDex 模型发现、安全文件夹导入、模型切换，以及每个模型分别保存名字 |
| 受管生命周期 | 随 Web DSH Host 启动，并在所属 Harness 进程结束时退出；设置开关也可以停止或重新启动桌宠 |
| 统一设置 | 显示、窗口置顶和位置锁定会在网页设置卡与桌宠托盘/抽屉之间同步 |
| 自适应设置入口 | 全家桶安装显示在「设置 → 插件 → Web UI 插件 → 宠物」；单独安装显示在「设置 → 插件 → 宠物」 |

模型选择和每个模型对应的名字继续在桌宠面板内管理，因为用户导入的模型目录只存在于桌面端，浏览器 Host 无法可靠枚举。

## 架构

```text
packages/dsh-pet/
|-- src/index.ts            Host 插件、设置、路由与桌宠生命周期
|-- src/service.ts          任务状态、亲密度、小鱼干和桌宠设置
|-- src/routes.ts           /api/pet/* 本地 REST/SSE 桥
|-- src/settings-bridge.ts  单独安装时使用的窄范围 loopback 设置桥
|-- src/settings-protocol.ts 设置回退的共享通信契约
|-- src/core/               多会话投影与 PetIntent 映射
|-- src/client/index.ts     只注册设置卡
|-- src/client/             设置卡和单独安装回退 scope
`-- desktop/
    |-- src/main/           Electron 生命周期、窗口、托盘和 Host 客户端
    |-- src/renderer/       桌宠面板与像素渲染器
    |-- src/shared/         经过校验的 IPC 与桥接契约
    |-- resources/          随包发布的托盘图标
    `-- pixelmodel/         被忽略的本地开发 PetDex 模型目录
```

### 数据流

```text
DSH 官方会话事件
        |
        v
PetService + PetIntent ---- /api/pet/events（SSE）---> Electron 桌面宠物
        ^                                                |
        |                                                |
        `--- /api/pet/companion-settings <---------------'

网页设置卡 <---- pet 设置命名空间 ----> PetService
```

- 桌面客户端优先使用 SSE；数据流不可用时才回退到 `/api/pet/state` 轮询。
- 摸头与喂食使用 `/api/pet/interact`。
- 桌面窗口改动使用 `/api/pet/companion-settings`，并回写同一个 `pet` 设置命名空间。
- 当 DSH 官方设置 RPC 未暴露第三方命名空间时，loopback-only 的 `/api/pet/settings/*` 回退仍通过同一份设置文档完成带 revision 防冲突的读写；全家桶安装则优先使用共享的 `dsh-web-ui-settings` 兼容 binder。
- 浏览器客户端不会再渲染宠物本体。

## 安装

单独安装插件包：

Electron 43 通过本包的 `postinstall` 下载当前平台二进制。pnpm 11 会先阻止依赖构建脚本，因此安装前需要在 `$DSH_HOME/profiles/<profile>/pnpm-workspace.yaml` 中显式信任本包：

```yaml
allowBuilds:
  '@linxin666/dsh-pet': true
```

然后安装 bundle：

```sh
dsh plugin --profile web add @linxin666/dsh-pet
```

包内包含预构建的 Host/浏览器产物和桌面运行时，并把 Electron 声明为运行时依赖；不需要同级源码仓库或全局 Electron。该授权具有安全含义：它允许本包的生命周期脚本下载 Electron 官方的平台二进制。

如果安装的是本地 tarball、file 或 Git 产物，pnpm 会按完整产物 spec 生成授权键，而不是只看 registry 包名。可以让第一次被阻止的安装在 `allowBuilds` 下写出精确占位项，把它生成的值改为 `true`，再执行 `dsh plugin --profile <profile> install`。不要猜测，也不要把带本机路径的产物键提交到共享配置。

聚合包已经依赖 `@linxin666/dsh-pet`。安装 `@linxin666/dsh-web-ui-all` 时会安装并激活同一个宠物 bundle，不会生成第二条重复 patch。

源码工作区开发：

```sh
pnpm install
pnpm --filter @linxin666/dsh-pet build
dsh plugin --profile web add link:<源码目录>/packages/dsh-pet
```

安装后重启 `dsh web`，Host 插件会从自身包内启动桌面运行时。修改 Host/client 或 Electron 代码后重新构建该包即可，link 安装无需重复添加。

## 设置

网页设置卡管理：

- 启动桌面宠物
- 显示桌面宠物
- 窗口置顶
- 锁定位置

桌宠面板管理 Web DSH 地址、像素模型选择/导入，以及每个模型分别保存的显示名。

## 配置与数据位置

Cordis 入口导出了 `Config` 类型和同名 Schemastery schema。亲密度、小鱼干、庆祝时长、持久化目录、活动元数据和生命周期开关都能在插件行的 `config` 中覆盖，并会在启动前完成校验。

- Host 亲密度和小鱼干数据默认保存在 `$DSH_HOME/pet.json`。
- 桌面窗口和模型偏好保存在 Electron 对应平台的 `userData` 目录。
- 用户导入的 PetDex 模型复制到 `userData/pixel-models`，不会写入安装包。
- `desktop/pixelmodel` 仅用于源码工作区本地模型开发，已被 Git 忽略。

## 开发

```sh
pnpm --filter @linxin666/dsh-pet typecheck
pnpm --filter @linxin666/dsh-pet test
pnpm --filter @linxin666/dsh-pet build
pnpm --filter @linxin666/dsh-pet desktop:smoke
```

## 已知限制

- 目前只连接 loopback 地址上的 Web DSH；桌面端和 CLI Harness 适配按计划暂缓。
- 支持 PetDex 版本 1/2 图集，但会把可用轨道映射到当前九种 DSH 活动动画，不会自动推断模型私有的额外动作。
- 相比原网页内渲染器，Electron 会显著增加安装下载量和空闲内存，首次下载还需要前述 profile 级 `allowBuilds` 授权。当前应用不内嵌 DSH Web，稳定连接使用 SSE，并只在精灵帧变化时重绘，以压低持续 CPU 与网络开销。
- 未签名开发版使用 Electron 通用可执行程序身份；若要跨安装路径保持稳定的原生应用身份，需要单独打包和签名桌面发行版。

## License

[BSD-3-Clause](LICENSE)
