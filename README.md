# Sandcastle for Agent

在现有 Git 仓库中初始化一个使用宿主 Codex、Docker 和 GitHub Issues 的
[Sandcastle](https://github.com/mattpocock/sandcastle) Harness。

它复用本机已经登录的 Codex 环境，按 Planner、Implementer、Reviewer、Merger
四个阶段处理带有 `ready-for-agent` 标签的 Issue。

## What Is Sandcastle for Agent?

上游 Sandcastle 负责 worktree、sandbox、agent provider 和提交收集。本工具在它之上
提供一条固定的本地 Codex 路径：

1. 通过 `npx` 使用固定版本的 `@ai-hero/sandcastle@0.12.0`。
2. 调用上游初始化 Codex + Docker + GitHub Issues Harness。
3. 自动读取宿主 `~/.codex/config.toml` 和 `~/.codex/auth.json`。
4. 应用四阶段模型配置和 `ready-for-agent` Issue 过滤规则。
5. 构建可直接运行的 Docker 镜像。

不需要克隆本仓库，也不需要先单独执行上游向导。

## Prerequisites

- Node.js 22+
- Git 和 npm
- 正在运行的 Docker
- 已登录的 GitHub CLI (`gh`)
- 已登录的 Codex CLI
- `~/.codex/config.toml`
- `~/.codex/auth.json`
- 运行前目标仓库至少有一个 Git commit

`init` 会检查这些条件。Codex provider、认证文件和本地网关地址不需要在向导中重复输入。

## Quick Start

### 1. 初始化 Harness

进入需要运行 Agent 的现有 Git 仓库：

```bash
cd /path/to/existing-repo
npx github:liumingjian/sandcastle-for-agent init
```

交互过程只询问是否加载推荐的四阶段模型配置。确认后，命令会调用上游 Sandcastle、
生成配置并构建 Docker 镜像。它不会创建或修改目标项目的 `package.json`、
`package-lock.json`、`pnpm-lock.yaml`、`yarn.lock` 或 `bun.lock`。

成功时会输出：

```text
Initialized parallel-planner-with-review with @ai-hero/sandcastle@0.12.0
```

如果仓库还没有 `ready-for-agent` 标签，初始化只会给出提示，不会中断。

初始化完成后先检查生成的 Harness 和项目基线，并创建一次 commit。新仓库不能只提交
`.sandcastle`，项目源文件也必须进入基线 commit；Sandcastle 需要已有 commit 才能创建
worktree 和 agent 分支：

```bash
git status
git add <project-files> .sandcastle
git commit -m "Initialize Sandcastle Harness"
```

### 2. 配置 GitHub token

```bash
cp .sandcastle/.env.example .sandcastle/.env
```

在 `.sandcastle/.env` 中写入只授权目标仓库的 fine-grained token：

```dotenv
GH_TOKEN=github_pat_xxx
```

最低权限：

- Issues: Read and write
- Metadata: Read-only

### 3. 标记要处理的 Issue

运行前，仓库中必须存在 `ready-for-agent` 标签。把它添加到需要实现的 open Issue：

```bash
gh issue edit 123 --add-label ready-for-agent
```

本工具不会创建标签，也不会处理没有该标签的 Issue。

### 4. 运行

```bash
npx github:liumingjian/sandcastle-for-agent run
```

工作流会读取带标签的 open Issues，完成规划、并行实现、审查和合并。没有符合条件的
Issue 时会正常结束。

如果运行时出现 `Missing optional dependency @openai/codex-linux-arm64` 或
`@openai/codex-linux-x64`，说明当前项目使用的是旧 Docker 镜像。重新构建一次即可：

```bash
npx github:liumingjian/sandcastle-for-agent configure --no-build
npx github:liumingjian/sandcastle-for-agent build
```

新镜像会显式安装当前架构的 Codex optional dependency，并在构建阶段执行
`codex --version` 验证。

## Host Codex Configuration

Codex 配置来自宿主机，不需要 `baseUrl` 参数：

- `~/.codex/config.toml`：读取当前 `model_provider` 和对应 provider 配置。
- `~/.codex/auth.json`：只读挂载到容器，不复制到项目。
- `~/.codex/AGENTS.md`：存在时默认只读挂载。

容器不能通过 `localhost` 访问宿主服务。本工具会自动转换宿主专用地址：

```text
http://127.0.0.1:15721/v1
                ↓
http://host.docker.internal:15721/v1
```

`localhost`、`127.0.0.1`、`0.0.0.0` 和本地 IPv6 地址都会转换；外部 HTTPS provider
保持不变。容器配置会在 `init`、`configure` 和每次 `run` 前刷新。

生成的 `.sandcastle/codex-config.toml` 已加入 `.gitignore`。它只包含运行所需的
provider 字段，不复制宿主 MCP、项目信任或其他机器配置。Codex 官方配置字段见
[Configuration Reference](https://developers.openai.com/codex/config-reference/)。

## Default Workflow

默认模板是 `parallel-planner-with-review`：

| Stage | Model | Reasoning effort |
| --- | --- | --- |
| Planner | `gpt-5.6-sol` | `xhigh` |
| Implementer | `gpt-5.6-luna` | `max` |
| Reviewer | `gpt-5.6-sol` | `xhigh` |
| Merger | `gpt-5.6-luna` | `max` |

模型配置保存在 `.sandcastle/for-agent.json`。`max` 会原样传给 Codex，不会自动降级。

## Commands

```bash
sandcastle-for-agent init
sandcastle-for-agent configure
sandcastle-for-agent build
sandcastle-for-agent run
```

- `init`：检查环境，安装固定依赖，调用上游初始化并构建镜像。
- `configure`：重新应用宿主 Codex 和阶段配置，不重新安装依赖。
- `build`：重新构建 Docker 镜像。
- `run`：检查认证、标签和镜像后运行工作流。

查看高级模型、工作流和构建参数：

```bash
npx github:liumingjian/sandcastle-for-agent --help
```

## Generated Files

```text
.sandcastle/
├── .env.example
├── .gitignore
├── CODING_STANDARDS.md
├── Dockerfile
├── codex-config.toml       # 本地生成，不提交
├── for-agent.json
├── main.mts                # 上游 Sandcastle 生成
└── *-prompt.md
```

`configure` 会更新本工具管理的配置和 prompts，但保留 `.env` 与上游生成的
`main.mts`。`main.mts` 是上游模板文件；`sandcastle-for-agent run` 使用本工具随
`npx` 提供的固定依赖，不要求把 Sandcastle 追加到目标项目的依赖中。

## Issue Selection

所有内置工作流使用同一查询：

```bash
gh issue list --state open --label ready-for-agent
```

`init` 在标签不存在时只提示；`run` 会拒绝启动。查询不会退化为处理全部 open Issues。

## Limitations

- 只支持 Codex + Docker + GitHub Issues。
- 初始化不会修改目标项目的包管理器文件；项目依赖仍由项目自身的包管理器管理。
- 只复用文件形式的 `~/.codex/auth.json`，不读取系统 keyring 凭据。
- 仓库仍处于早期阶段，当前没有开源许可证。

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

升级 Sandcastle 时需要显式修改固定版本，并重新验证上游初始化输出。
