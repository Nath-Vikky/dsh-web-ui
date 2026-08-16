# ADR 001：桌面伴侣发布边界

## 状态

Fork 原型已接受，日期为 2026-08-16；正式上游 PR 前仍需维护者先确认功能范围。

## 上下文

新的 `dsh-pet` 用透明桌面窗口替代网页内浮层。它必须既能作为单包安装，也能通过 `dsh-web-ui-all` 安装；如果桌面应用留在仓库级 `apps/` 目录，发布后的插件无法找到同级源码，也不符合 Harness bundle 的自包含要求。

## 决策

- Host、浏览器设置卡、Electron 源码、桌面构建产物和托盘资源全部归属 `packages/dsh-pet`。
- npm/tarball 包携带预构建的 `lib/` 与 `desktop/out/`；源码安装的 `prepare` 同时构建两者，不依赖同级仓库。
- Electron 是 `@linxin666/dsh-pet` 的运行时依赖。单独安装与聚合安装都解析同一个插件包和同一条 patch，不创建第二套宠物实例。
- 浏览器端只注册设置卡，不渲染桌宠，也不嵌入 DSH Web。
- Host 启动桌面进程并传入所属 Harness PID；插件卸载或 Harness 退出时释放桌面进程。
- 桌面配置与导入模型写入 Electron `userData`，Host 亲密度和小鱼干仍写入 `$DSH_HOME`；安装目录保持只读。

## 兼容约束

- 插件继续导出稳定的 `name`、`inject`、`apply`、`Config` 和 bundle manifest。
- 桌面端只消费 `/api/pet/*` 的渲染器无关状态，不读取 DSH 源码或非公开内部模块。
- 用户已保存的亲密度和小鱼干结构继续由版本化解析器读取；无效或已删除的模型选择回退到内置模型。
- 用户本地 `pixelmodel` 目录不进入 Git 或 npm 包；导入功能把经过校验的模型复制到用户数据目录。

## 结果

插件具备真正的单包安装形态，代价是 Electron 下载量和常驻内存显著高于网页浮层。这个代价必须在功能 Issue 和 PR 证据中明确披露。
