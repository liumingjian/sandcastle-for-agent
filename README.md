# Sandcastle for Agent

在现有 Git 仓库中初始化一个使用宿主 Codex、Docker 和 GitHub Issues 的
[Sandcastle](https://github.com/mattpocock/sandcastle) Harness。

它复用本机已经登录的 Codex 环境，按 Planner、Implementer、Reviewer、Merger
四个阶段处理带有 `ready-for-agent` 标签的 Issue。工作流编排仍由上游生成的
`.sandcastle/main.ts` 或 `.sandcastle/main.mts` 负责，本工具只为它接入宿主 Codex 配置。

## What Is Sandcastle for Agent?

上游 Sandcastle 负责 worktree、sandbox、agent provider、提交收集和工作流循环。本工具在
它生成的入口上做一层固定版本适配：

1. 通过 `npx` 使用固定版本的 `@ai-hero/sandcastle@0.12.0`。
2. 调用上游初始化 Codex + Docker + GitHub Issues Harness，保留上游的 `main.ts/main.mts` 编排。
3. 在 `build` 阶段直接修正入口中的 `codex()`、`docker()`、`mounts` 和模型配置。
4. 自动读取宿主 `~/.codex/config.toml` 和 `~/.codex/auth.json`。
5. 应用四阶段模型配置和 `ready-for-agent` Issue 过滤规则。
6. 构建可直接运行的 Docker 镜像。

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

交互过程只询问是否加载推荐的四阶段模型配置。确认后，命令会调用上游 Sandcastle，
生成基础 Harness 配置和上游工作流入口，但不会改写入口或构建 Docker 镜像。

初始化会在 `.sandcastle/` 内创建独立的 Harness 依赖包，并执行一次
`npm install --prefix .sandcastle`，不会修改目标项目的依赖或 lock 文件。

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

### 2. 构建适配入口

```bash
npx github:liumingjian/sandcastle-for-agent build
```

`build` 会从固定的 `@ai-hero/sandcastle@0.12.0` 模板重新生成并改写
`.sandcastle/main.ts` 或 `.sandcastle/main.mts`，写入宿主 Codex 的 mount 和阶段模型，
然后构建 Docker 镜像。构建完成后，它会在项目 `package.json` 中只增加一个 script：

```json
{"scripts":{"sandcastle":"npx tsx .sandcastle/main.ts"}}
```

如果项目已经使用同名 script 但命令不同，构建会停止并要求先处理脚本命名冲突，不会静默覆盖。
没有根 `package.json` 时，script 会写入 `.sandcastle/package.json`，执行
`npm --prefix .sandcastle run sandcastle`。

### 3. 运行

首次运行前，先配置 GitHub token 和需要处理的 Issue。

#### 配置 GitHub token

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

#### 标记要处理的 Issue

仓库中必须存在 `ready-for-agent` 标签。把它添加到需要实现的 open Issue：

```bash
gh issue edit 123 --add-label ready-for-agent
```

本工具不会创建标签，也不会处理没有该标签的 Issue。

#### 执行生成的 script

```bash
npm run sandcastle
```

这条命令就是上游入口的执行封装。对于有根 `package.json` 的项目，实际执行的是：

```bash
npx tsx .sandcastle/main.ts
```

如果上游根据项目类型生成的是 `main.mts`，脚本会自动使用对应扩展名。
没有根 `package.json` 时，执行 `npm --prefix .sandcastle run sandcastle`。

`npx github:liumingjian/sandcastle-for-agent run` 仍可作为带环境、标签和镜像预检的可选入口，
但 Quick Start 的标准流程是 `npm run sandcastle`。

工作流会读取带标签的 open Issues，完成规划、并行实现、审查和合并。没有符合条件的
Issue 时会正常结束。上游的 worktree、sandbox、提交和合并生命周期没有被本工具重新实现。

Sandcastle 的 worktree 是临时目录：当实现分支已经提交且阶段正常结束时，
`sandbox.close()` 会删除这个干净的 worktree，但会保留 `sandcastle/*` Git 分支；
parallel 工作流随后由 merger 把这些分支合并到当前分支。若某个 Agent 在提交前失败，
合并阶段不会运行，请先检查日志和分支：

```bash
git branch --list 'sandcastle/*'
git log --all --oneline --decorate --max-count=30
ls -lt .sandcastle/logs
```

`sequential-reviewer` 遵循上游模板，只实现并审查分支，不自动把该分支合并到当前分支；
需要手动检查并合并对应的 `sandcastle/sequential-reviewer/*` 分支。

如果运行时出现 `Missing optional dependency @openai/codex-linux-arm64` 或
`@openai/codex-linux-x64`，说明当前项目使用的是旧 Docker 镜像。重新构建一次即可：

```bash
npx github:liumingjian/sandcastle-for-agent configure --no-build
npx github:liumingjian/sandcastle-for-agent build
```

构建分为两层：第一层以 `.sandcastle/Dockerfile` 为来源；如果其中包含上游的全局 Codex
安装步骤，只会在临时副本中延后这一步。第二层使用临时 Dockerfile 补装当前架构的 Codex
alias，并执行 `codex --version` 验证。临时文件和中间镜像会在构建结束后清理；目标仓库中的
`.sandcastle/Dockerfile` 不会被本工具覆盖或改写。

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

`.sandcastle/for-agent.json` 由适配入口在 `main.ts/main.mts` 启动时读取。它保存工作流、各阶段
模型和思考模式、最大迭代次数以及是否挂载全局 `AGENTS.md`。因此修改这些运行时配置不需要
重写上游编排。切换工作流或升级固定上游版本时，执行 `build` 重新生成入口。

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

- `init`：检查环境，调用上游初始化，生成基础配置并安装 Harness 依赖；不改写入口、不生成 script、不构建镜像。
- `configure`：更新宿主 Codex 和阶段配置，补齐 `.sandcastle/` 内缺失的 Harness 依赖。
- `build`：按固定的 `@ai-hero/sandcastle@0.12.0` 重新生成 `main.ts/main.mts`、脚本和 Docker 镜像。
- `run`：可选的预检包装命令；标准流程直接执行 `npm run sandcastle`。

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
├── for-agent-runtime.mjs   # 宿主配置读取和路径准备
├── main.ts/main.mts        # 上游编排 + 本地 provider 配置
├── package.json             # Harness 独立依赖
├── package-lock.json        # Harness 独立 lock 文件
├── node_modules/            # .gitignore，不提交
└── *-prompt.md
```

`main.ts/main.mts` 是实际执行入口，不是旁路配置文件。`build` 从固定的上游模板开始，
在入口顶部加入宿主配置读取、显式 `mounts`、`docker({...})` 和按阶段读取模型的
`codex(model, { effort })`，工作流正文仍来自上游。循环、worktree、sandbox 生命周期和
merge 逻辑不会由本工具重新实现。

根项目如果有 `package.json`，会增加：

```json
{"scripts":{"sandcastle":"npx tsx .sandcastle/main.ts"}}
```

实际扩展名由上游模板决定；根项目没有 `package.json` 时，该脚本保存在 Harness 自己的
`.sandcastle/package.json` 中。

`Dockerfile` 也保持上游生成版本。`sandcastle-for-agent build` 只在临时构建层中添加宿主
Codex 兼容逻辑，不覆盖目标仓库中的 `.sandcastle/Dockerfile`。

`.sandcastle/package.json`、`package-lock.json` 和 `node_modules/` 只属于 Harness，和目标
项目根目录的包管理器文件隔离。这样既能让 `main.ts/main.mts` 使用上游依赖，也不会把依赖安装到
用户项目中。

## Issue Selection

所有内置工作流使用同一查询：

```bash
gh issue list --state open --label ready-for-agent
```

`init` 在标签不存在时只提示；`run` 会拒绝启动。查询不会退化为处理全部 open Issues。

## Limitations

- 只支持 Codex + Docker + GitHub Issues。
- 初始化不会修改目标项目根目录的依赖或 lock 文件；只会增加一个执行脚本。Harness 依赖
  安装在 `.sandcastle/` 内，项目依赖仍由项目自身的包管理器管理。
- 只复用文件形式的 `~/.codex/auth.json`，不读取系统 keyring 凭据。
- 仓库仍处于早期阶段，当前没有开源许可证。

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

升级 Sandcastle 时需要显式修改固定版本，并重新验证上游初始化输出。
