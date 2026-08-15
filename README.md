# Sandcastle for Agent

Sandcastle for Agent 是 [Sandcastle](https://github.com/mattpocock/sandcastle)
的宿主 Codex 补充层。它面向已经使用本地 Codex 和 GitHub Issues 的个人工作流，
负责补上宿主认证映射、阶段模型配置和 `ready-for-agent` 标签约束。

推荐先使用上游 Sandcastle 生成标准 Harness，再用本工具应用 Codex 定制。也可以跳过
上游向导，直接使用本工具的一键初始化入口。

## 与 Sandcastle 的关系

上游 Sandcastle 负责基础能力：

- 安装编排库。
- 创建 Git worktree 和隔离 sandbox。
- 提供 Codex、Docker、GitHub Issues 和工作流模板。
- 收集提交并处理分支。

本工具负责宿主 Codex 适配：

- 将宿主机 `~/.codex/auth.json` 只读挂载到 Docker sandbox。
- 自动加载存在的 `~/.codex/AGENTS.md`。
- 为 Planner、Implementer、Reviewer、Merger 设置推荐模型。
- 把 GitHub Issue 入口固定为 open + `ready-for-agent`。
- 检查 Codex 登录、GitHub 标签和 Docker 镜像后再启动工作流。

### 为什么仍有部分重复

当前仓库确实保留了上游四阶段编排、prompt 和 Dockerfile 的定制版本。这些文件包含
阶段级模型、宿主认证挂载和固定标签规则，无法只靠上游初始化参数表达。

这部分重复是有意的覆盖层。Sandcastle 的分支、sandbox 和 agent provider 仍直接来自
`@ai-hero/sandcastle`；本仓库不重新实现这些底层能力。执行 `configure` 时，上游生成的
`main.mts` 会保留，但本工具的 `run` 使用包内定制编排。

## 适用范围

适合：

- 在已有 Git 仓库中运行无人值守的 GitHub Issue 工作流。
- 使用宿主机 Codex 登录或宿主机上的本地 API 网关。
- 希望严格限制为 `ready-for-agent` Issue。

不适合：

- 没有 Docker 的运行环境。
- 需要 Claude Code、Vercel sandbox 或其他 Issue tracker 的项目。
- 希望直接复用系统 keyring，但宿主机没有 `~/.codex/auth.json` 的环境。

## 先决条件

- Node.js 22+
- Git
- Docker
- GitHub CLI (`gh`)
- 已登录并可用的 Codex CLI
- 宿主机存在 `~/.codex/auth.json`

先检查本机环境：

```bash
docker --version
gh --version
codex login status
test -f ~/.codex/auth.json
```

## 快速开始：先用上游初始化

以下步骤从一个已有 Git 仓库开始。

### 1. 安装 Sandcastle 依赖

```bash
cd /path/to/existing-repo
test -f package.json || npm init -y
npm install --save-dev @ai-hero/sandcastle tsx zod
```

### 2. 生成标准 Harness

运行上游向导：

```bash
npx @ai-hero/sandcastle init
```

在向导中选择：

| 问题 | 选择 |
| --- | --- |
| Agent | `Codex` |
| Sandbox provider | `Docker` |
| Issue tracker | `GitHub Issues` |
| Template | `parallel-planner-with-review` |
| Create `Sandcastle` label | `No` |
| Build image now | `No` |

`Sandcastle` 标签不是本工具的任务入口，因此不要创建。依赖已在上一步安装；如果向导
询问是否安装 Zod，也可以选择 `No`。

也可以非交互生成同一套基础文件：

```bash
npx @ai-hero/sandcastle init \
  --agent codex \
  --sandbox docker \
  --issue-tracker github-issues \
  --template parallel-planner-with-review \
  --create-label false \
  --install-template-deps false \
  --build-image false
```

### 3. 配置 GitHub token

```bash
cp .sandcastle/.env.example .sandcastle/.env
```

编辑 `.sandcastle/.env`：

```dotenv
GH_TOKEN=github_pat_xxx
```

建议使用 fine-grained personal access token，只授权目标仓库：

- Issues: Read and write
- Metadata: Read-only

### 4. 应用宿主 Codex 定制

```bash
npx github:liumingjian/sandcastle-for-agent configure \
  --create-label \
  --build
```

交互过程只询问一次：是否应用推荐的四阶段配置。确认后，本工具会：

- 固定为 `parallel-planner-with-review`。
- 写入推荐阶段模型。
- 在宿主文件存在时自动加载全局 `AGENTS.md`。
- 创建 `ready-for-agent` 标签。
- 生成容器 Codex 配置并构建 Docker 镜像。

### 5. 标记 Issue 并运行

```bash
gh issue edit 123 --add-label ready-for-agent
npx github:liumingjian/sandcastle-for-agent run
```

首次成功时会看到 Planner 开始一个 cycle，并且只列出带 `ready-for-agent` 标签的
open issues。没有符合条件的 Issue 时，工作流会正常停止。

## 快捷路径：直接创建 Harness

不需要先体验上游向导时，可以直接运行：

```bash
cd /path/to/existing-repo
npx github:liumingjian/sandcastle-for-agent init \
  --create-label \
  --build
```

这个入口生成相同的定制运行文件。目标仓库不需要预先安装 Sandcastle，但推荐主路径
仍然是先运行上游初始化，这样用户能看到并理解 Harness 的标准组成。

## 推荐模型配置

交互向导只询问是否加载下面这一组默认值：

| 阶段 | 模型 | Reasoning effort |
| --- | --- | --- |
| Planner | `gpt-5.6-sol` | `xhigh` |
| Implementer | `gpt-5.6-luna` | `max` |
| Reviewer | `gpt-5.6-sol` | `xhigh` |
| Merger | `gpt-5.6-luna` | `max` |

`max` 会原样传给容器内 Codex。它取决于宿主 Codex、账号和模型是否支持；不支持时
Codex 会在运行阶段报错，本工具不会静默降级为 `xhigh`。

配置保存在 `.sandcastle/for-agent.json`，可提交到项目仓库。

## `baseUrl` 是什么

`baseUrl` 是 Codex 模型提供方的 API 根地址，不是 Sandcastle 服务地址。Codex 官方
[配置参考](https://developers.openai.com/codex/config-reference/#configtoml)将
`model_providers.<id>.base_url` 定义为模型 provider 的 API base URL。

默认值：

```text
http://host.docker.internal:15721/v1
```

各部分含义：

- `host.docker.internal`：Docker 容器访问宿主机的特殊域名。
- `15721`：宿主机本地 Codex 网关监听端口；本仓库默认对应 cc-switch。
- `/v1`：兼容 Responses API 的根路径。

因此数据路径是：

```text
容器内 Codex -> host.docker.internal:15721 -> 宿主机 cc-switch -> 实际模型 provider
```

只有宿主机确实在该端口运行兼容网关时才能使用这个默认值。其他环境应显式覆盖：

```bash
npx github:liumingjian/sandcastle-for-agent configure \
  --base-url https://api.openai.com/v1
```

如果网关使用其他端口，也要改成对应的 `host.docker.internal:<port>/v1`。不要在容器
配置中使用 `127.0.0.1` 或 `localhost` 指向宿主服务，这两个地址在容器中代表容器本身。

## Issue 入口规则

所有内置 prompt 都使用固定查询：

```bash
gh issue list --state open --label ready-for-agent
```

标签不存在时，`run` 会直接失败，不会退化成实现所有 open issues。

## 配置文件

必需配置：

- `.sandcastle/.env`：只放 `GH_TOKEN`。
- `.sandcastle/for-agent.json`：工作流、模型、provider URL 和迭代限制。
- `~/.codex/auth.json`：宿主 Codex 认证文件，只读挂载。

常用可选配置：

- `~/.codex/AGENTS.md`：存在时由推荐配置自动只读挂载。
- `--base-url`：覆盖宿主 Codex 网关地址。
- `--no-global-agents`：明确关闭全局指令映射。

`.sandcastle/.env` 不允许声明 `OPENAI_API_KEY`、`OPENAI_KEY` 或 `CODEX_API_KEY`；
本工具只复用宿主 Codex 环境。

## 命令

```bash
sandcastle-for-agent init
sandcastle-for-agent configure
sandcastle-for-agent build
sandcastle-for-agent run
```

- `init`：在尚无 `.sandcastle` 的 Git 仓库中直接创建定制 Harness。
- `configure`：在上游或本工具生成的 `.sandcastle` 上应用定制。
- `build`：构建 `.sandcastle/Dockerfile` 对应的镜像。
- `run`：完成认证、标签和镜像检查后运行四阶段工作流。

查看自动化脚本可用的高级参数：

```bash
npx github:liumingjian/sandcastle-for-agent --help
```

## 生成或覆盖的文件

```text
.sandcastle/
├── .env.example
├── .gitignore
├── CODING_STANDARDS.md
├── Dockerfile
├── codex-config.toml
├── for-agent.json
└── *-prompt.md
```

`configure` 会覆盖以上受管文件，但保留上游生成的 `main.mts` 和已有 `.env`。

## 当前限制

- 当前只支持 Codex + Docker + GitHub Issues。
- 默认 provider URL 是个人 cc-switch 配置，不是 Sandcastle 通用默认值。
- `max` 超出 Sandcastle 0.12 的公开 TypeScript effort 联合类型；本工具按 Codex
  运行时能力透传，并有回归测试覆盖最终命令。
- 仓库当前未声明开源许可证，`package.json` 标记为 `UNLICENSED`。

## 本仓库开发

```bash
npm install
npm run check
npm pack --dry-run
```

仓库类型为早期阶段的 CLI 工具。主路径已有自动化测试，但上游 Sandcastle 模板变化时，
仍需重新核对覆盖文件和运行流程。
