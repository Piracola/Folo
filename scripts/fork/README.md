# Folo 本地增强 fork

这个分支只做两件事，改动集中在少数几行 + 一组新文件，方便跟着上游 rebase。

- 分支：`local-enhance`（从上游 `dev` 拉出）
- 范围：仅 Windows 桌面端（`apps/desktop`）
- 上游：`RSSNext/Folo` 的 `dev` 分支

## 一、改动范围

### 1. 功能开关恒为开

`apps/desktop/layer/renderer/src/hooks/biz/useFeature.ts`

- `checkFeatureEnabled` 在调试面板没开 `__override` 时直接返回 `true`，即 App 内的功能开关（目前就是 `ai`）永远为开，AI 入口始终可见。
- 没有伪造任何东西：套餐页、升级提示、支付流程、需要官方后端校验的请求都保持原样。

### 2. 可自定义 AI 服务商（不依赖官方 AI）

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
- `scripts/fork/sync-upstream.ps1`、本 README

修改（每处都只有几行）：

- `hooks/biz/useFeature.ts` — 功能开关恒开
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

## 四、冲突怎么处理

- 新增文件永远不会冲突。
- 冲突只会出现在上面「修改」清单里那几个文件，通常都是几行。原则：保留本 fork 的写法（分支判断、模型名、`useAISummary` 的替换），再 `git add` + `git rebase --continue`，最后跑一次 `-Typecheck`。
- 万一上游把这些文件重写了，就按「意图」重新加回去：聊天传输层换成 `LocalChatTransport`、模型 id 用 `formatLocalAIModelId`、摘要 hook 换成 `useAISummary`、标题走 `generateLocalChatTitle`。

## 五、已知限制

- 本机模式的系统提示是简版，没有官方按场景拼的长提示，回答风格会朴素一些。
- 上下文块只处理：当前条目正文（截断 12000 字）、订阅源/时间线提示、附件仅给文件名。
- 不返回 token 用量，因此用量统计与 `TokenUsagePill` 不显示。
- 账号级 BYOK（把密钥上传到 Folo 服务器）保持原样，会员限制仍由服务器判断；本机服务商是另一条独立通道。
