# Folo 本地增强 fork

这个分支只做两件事，改动集中在少数几行 + 一组新文件，方便跟着上游 rebase。

- 分支：`local-enhance`（从上游 `dev` 拉出）
- 范围：仅 Windows 桌面端（`apps/desktop`）
- 上游：`RSSNext/Folo` 的 `dev` 分支

## 一、改动范围

### 1. 功能开关恒为开

`apps/desktop/layer/renderer/src/hooks/biz/useFeature.ts`

- `checkFeatureEnabled` 在调试面板没开 `__override` 时直接返回 `true`，即 App 内的功能开关（目前就是 `ai`）永远为开，AI 入口始终可见。

### 2. 界面按「会员」对待

`apps/desktop/layer/renderer/src/modules/patch/unlock-membership.ts`（在 `main.tsx` 里引入）

- 登录后把用户仓库里的角色改写成 `Pro`，于是所有 `role === Free` 判断放行：设置里带 `paidLevel` 的项不再置灰、订阅/列表表单不再要求升级、翻译预取、评论提示等一起放开。
- 只影响本机界面。真正由服务器判定的东西（官方 AI 额度、官方账号权益）不会因为这一改而改变；AI 请用下面的本机服务商。

### 3. 可自定义 AI 服务商（不依赖官方 AI）

新代码放在 `modules/local-ai`、`atoms/local-ai.ts` 和主进程的 `ipc/services/ai.ts`，官方文件只动了几个分支点。

覆盖能力：

| 能力                          | 是否走本机服务商 |
| ----------------------------- | ---------------- |
| AI 聊天（含思考过程流式显示） | 是               |
| 条目 AI 摘要 / 欢迎页摘要卡片 | 是               |
| 会话标题生成                  | 是               |
| 官方时间线增强摘要、定时任务  | 否（仍走官方）   |

聊天请求由**主进程**发起（`net.fetch`），因此不受 CORS 限制、跟随应用的代理设置，密钥不出本机。

### 文件清单

新增：

- `apps/desktop/layer/main/src/ipc/services/ai.ts` — 主进程直连服务商：SSE 流式、取消、非流式补全
- `apps/desktop/layer/renderer/src/atoms/local-ai.ts` — 本机服务商配置（只存本机，不同步账号）
- `apps/desktop/layer/renderer/src/modules/local-ai/bridge.ts` — IPC 流式桥
- `apps/desktop/layer/renderer/src/modules/local-ai/chat-transport.ts` — 聊天传输层（写出与官方一致的消息块）
- `apps/desktop/layer/renderer/src/modules/local-ai/prompt.ts` — 消息与上下文块转提示词
- `apps/desktop/layer/renderer/src/modules/local-ai/tasks.ts` — 摘要、标题生成
- `apps/desktop/layer/renderer/src/modules/settings/tabs/ai/local-provider/LocalProviderSection.tsx` — 设置界面
- `apps/desktop/layer/renderer/src/modules/patch/unlock-membership.ts` — 把登录账号按 Pro 对待
- `.github/workflows/build-windows-fork.yml` — 云端出 Windows 安装包
- `scripts/fork/sync-upstream.ps1`、本 README

修改（每处都只有几行）：

- `hooks/biz/useFeature.ts` — 功能开关恒开
- `src/main.tsx` — 引入会员解锁
- `modules/ai-chat/store/transport.ts` — 启用本机服务商时换掉聊天传输层
- `modules/ai-chat/hooks/useAIModel.ts` — 模型名显示为本机模型
- `modules/ai-chat/utils/titleGeneration.ts` — 标题走本机
- `modules/entry-content/components/AISummary.tsx`、`modules/ai-chat/components/welcome/EntrySummaryCard.tsx`、`modules/ai-chat/components/layouts/ChatInterface.tsx` — 摘要改用 `useAISummary`
- `modules/settings/tabs/ai.tsx` — 增加「本机 AI 服务」分区
- `apps/desktop/layer/main/src/ipc/index.ts` — 注册 `AiService`
- `locales/ai/{en,zh-CN,zh-TW,ja,fr-FR}.json` — `local_provider.*` 文案

## 二、怎么用

1. 设置 → AI → **本机 AI 服务**，打开开关。
2. 选服务商（DeepSeek / OpenAI / Moonshot / OpenRouter / Ollama / 自定义 OpenAI 兼容），填接口地址、密钥、模型名，点「测试连接」。
3. 之后聊天、摘要、标题都由这个服务商回答；关掉开关立刻回到官方行为。

Ollama 这类本机运行时，接口地址填 `http://127.0.0.1:11434/v1`，密钥留空。

开关打开但接口地址或模型还空着时，聊天和摘要会直接报错提示你去补全，不会悄悄切回官方后端。

## 三、跟随上游发版

```powershell
pwsh scripts/fork/sync-upstream.ps1                      # 只同步
pwsh scripts/fork/sync-upstream.ps1 -Install -Typecheck   # 同步 + 装依赖 + 类型检查
pwsh scripts/fork/sync-upstream.ps1 -Build                # 同步 + 打包 Windows 安装程序
```

脚本流程：补 `upstream` remote → `fetch` → 把 `local-enhance` rebase 到 `upstream/dev` → 冲突则整体中止并列出文件 → 锁文件有变化时提示装依赖 → 可选类型检查 / 打包。

想每天自动跑：任务计划程序新建任务，操作填
`pwsh -NoProfile -File "I:\JBCode\AI Tools\Folo\scripts\fork\sync-upstream.ps1"`，起始位置填仓库根目录。

### 本机 pnpm 注意

仓库要求 pnpm 12.5.1，你机器上的全局 `pnpm` 指向了失效路径，所以命令请用 `corepack pnpm ...`。
安装依赖时如果卡在根 `postinstall` 的版本检查，加参数：

```powershell
corepack pnpm install --config.pm-on-fail=ignore
```

## 四、云端构建（GitHub Actions）

一条流水线 `.github/workflows/build-windows-fork.yml` 管三件事：

| 触发                   | 做什么                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| 推送到 `local-enhance` | 直接构建，产出安装包                                                 |
| 每天 10:00（北京时间） | 先 rebase 到 `upstream/dev`，有变化才构建；冲突则开一个 issue 并中止 |
| 打 `fork/v*` 标签      | 构建 + 发 GitHub Release，装过的人能看到新版本                       |
| Actions 页手动运行     | 同上（同步 + 构建）                                                  |

拿安装包：Actions → 对应那次运行 → 页面底部 **Artifacts** → `folo-windows-x64`。打标签发布的版本则直接在 Releases 页下载。

说明：

- 用的是 GitHub 免费提供的 Windows runner，公共仓库不花钱；一次大约六分钟。
- 安装包**没有代码签名**，第一次运行 Windows 会提示「未知发布者」，选「更多信息 → 仍要运行」即可。
- 没配任何仓库变量，所以构建出来的 app 用的就是官方 API（`https://api.folo.is`），登录、同步照旧，AI 走你在设置里填的本机服务商。
- **自动更新已关闭**：官方更新源只会发官方版本，开着的话某次退出后 app 会把自己换回原版。新版本靠你自己看 Release / Artifacts 决定装不装。
- 上游自带的 `build-desktop.yml` 也会在推送时被触发（它在 fork 上也会跑完整的 mac/win/linux 矩阵，但签名步骤会跳过，产出的是未签名包）。不影响我们这条流程，但会白白占三台机器：fork 的 Actions 页面里选「🖥️ Build Desktop」→ 右上角 `⋯` → **Disable workflow** 关掉即可。

## 五、冲突怎么处理

- 新增文件永远不会冲突。
- 冲突只会出现在上面「修改」清单里那几个文件，通常都是几行。原则：保留本 fork 的写法（分支判断、模型名、`useAISummary` 的替换），再 `git add` + `git rebase --continue`，最后跑一次 `-Typecheck`。
- 万一上游把这些文件重写了，就按「意图」重新加回去：聊天传输层换成 `LocalChatTransport`、模型 id 用 `formatLocalAIModelId`、摘要 hook 换成 `useAISummary`、标题走 `generateLocalChatTitle`。

## 六、已知限制

- 本机模式的系统提示是简版，没有官方按场景拼的长提示，回答风格会朴素一些。
- 上下文块只处理：当前条目正文（截断 12000 字）、订阅源/时间线提示、附件仅给文件名。
- 不返回 token 用量，因此用量统计与 `TokenUsagePill` 不显示。
- 账号级 BYOK（把密钥上传到 Folo 服务器）保持原样，会员限制仍由服务器判断；本机服务商是另一条独立通道。
- 额度提示已在本机模式下去掉（`useAIConfiguration` 返回不限量），但**官方 AI 端点的其他能力**（翻译、批量翻译、语音朗读、每日摘要）目前仍走官方后端，需要会员才能用；要全部接管见第七节。

## 七、接管全部 AI 能力（设计）

官方 AI 一共这些端点：`chat`、`summary`、`summaryTitle`、`translation`、`translationBatch`、`tts`、`daily`、`config`、`memory.*`。
现在本机接管了 `chat`（传输层）、`summary` 与 `summaryTitle`（hook），其余仍打官方后端。

要「一劳永逸」，不该继续逐个功能打补丁，而是收敛到一个**唯一的出口**：

> `apps/desktop/layer/renderer/src/lib/api-client.ts` 里的 `FollowClient` 用了自定义 `fetch`，**所有**官方 API 请求都从这里过。

在这个 fetch 里按路径分流即可：

- 命中 `/ai/*` → 交给本机实现，构造一个 `Response` 返回（JSON 的端点直接回对象，流式的回 `ReadableStream`）
- 没命中 / 没实现的端点 → 原样放行到官方后端

好处：

- 拦截点只有一个，上游再改 UI、加功能都不影响
- 每个端点只需要一个「协议适配器」，逻辑和现在的 `LocalChatTransport`、`tasks.ts` 一样
- 现有 hook 级补丁（摘要、标题）以后可以删掉，改由拦截器统一处理，上游 diff 更小

建议顺序：`translation` → `daily` → `translationBatch` → `tts`（音频需要另一套处理，最后再说）。
