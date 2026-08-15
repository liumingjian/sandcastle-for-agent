# Sandcastle for Agent

Sandcastle for Agent 是 [Sandcastle](https://github.com/mattpocock/sandcastle)
的宿主 Codex 集成层。它把上游初始化、固定依赖、宿主认证映射、阶段模型配置、
GitHub Issue 约束和 Docker 镜像构建收敛到一个 `init` 命令中。

用户不需要先克隆两个仓库，也不需要单独运行上游向导。直接在要执行任务的现有 Git
仓库中调用本工具即可。

## 一条命令完成初始化

先确保目标仓库已经关联 GitHub，并且仓库中已有 `ready-for-agent` 标签，然后执行：

```bash
cd /path/to/existing-repo
npx github:liumingjian/sandcastle-for-agent init
```

交互过程只询问是否应用推荐的四阶段模型配置。确认后，`init` 会依次完成：

1. 检查当前目录是 Git 仓库，且尚未存在 `.sandcastle`。
2. 检查 npm、Docker daemon、GitHub CLI 登录、Codex 登录和
   `~/.codex/auth.json`。
3. 检查 GitHub 仓库中已经存在 `ready-for-agent` 标签，不创建标签。
4. 在没有 `package.json` 时执行 `npm init --yes`。
5. 精确安装 `@ai-hero/sandcastle@0.12.0` 及模板依赖 `tsx`、`zod`。
6. 调用上游 `sandcastle init`，固定选择 Codex、Docker、GitHub Issues 和
   `parallel-planner-with-review`。
7. 叠加宿主 Codex 认证、全局 `AGENTS.md`、阶段模型和固定 Issue 查询规则。
8. 构建定制 Docker 镜像。

初始化不会执行 `git clone`，因此可以直接用于已有 Git 项目，也不会与项目自己的
`.git` 目录冲突。

## 先决条件

- Node.js 22+
- npm
- Git
- 正在运行的 Docker
- 已登录目标 GitHub 账号的 GitHub CLI (`gh`)
- 已登录并可用的 Codex CLI
- 宿主机存在 `~/.codex/auth.json`
- 目标 GitHub 仓库已存在 `ready-for-agent` 标签

`init` 会实际执行检查；也可以提前确认：

```bash
docker info
gh auth status
codex login status
test -f ~/.codex/auth.json
```

标签由仓库维护者预先管理。本工具只验证，不提供创建标签的设置，也不会调用上游的
`Sandcastle` 标签创建逻辑。

## 配置 GitHub token

初始化完成后创建本地环境文件：

```bash
cp .sandcastle/.env.example .sandcastle/.env
```

编辑 `.sandcastle/.env`：

```dotenv
GH_TOKEN=github_pat_xxx
```

建议使用只授权目标仓库的 fine-grained personal access token：

- Issues: Read and write
- Metadata: Read-only

本工具不会把宿主 GitHub CLI 的凭据写入项目，也不会自动持久化 token。

## 运行

给需要实现的 open Issue 添加固定标签：

```bash
gh issue edit 123 --add-label ready-for-agent
```

然后启动 Harness：

```bash
npx github:liumingjian/sandcastle-for-agent run
```

工作流只查询：

```bash
gh issue list --state open --label ready-for-agent
```

标签不存在时，`init` 和 `run` 都会失败，不会退化为处理全部 open issues。

## 推荐模型配置

`init` 默认建议加载下面这一组配置：

| 阶段 | 模型 | Reasoning effort |
| --- | --- | --- |
| Planner | `gpt-5.6-sol` | `xhigh` |
| Implementer | `gpt-5.6-luna` | `max` |
| Reviewer | `gpt-5.6-sol` | `xhigh` |
| Merger | `gpt-5.6-luna` | `max` |

`max` 会原样传给容器内 Codex。它取决于宿主 Codex、账号和模型是否支持；不支持时
Codex 会在运行阶段报错，本工具不会静默降级。

配置保存在 `.sandcastle/for-agent.json`，可以提交到项目仓库。高级自动化场景仍可用
`--<stage>-model` 和 `--<stage>-effort` 覆盖单个阶段。

## 与上游 Sandcastle 的关系

本工具依赖并精确固定 `@ai-hero/sandcastle@0.12.0`。`init` 不是重新实现上游向导，
而是非交互调用下面这组固定选择：

```bash
sandcastle init \
  --agent codex \
  --sandbox docker \
  --issue-tracker github-issues \
  --template parallel-planner-with-review \
  --create-label false \
  --install-template-deps false \
  --build-image false
```

上游负责 Git worktree、sandbox、agent provider、基础工作流模板和提交收集。本工具在
上游生成结果之上覆盖以下内容：

- 把宿主机 `~/.codex/auth.json` 只读挂载到 Docker sandbox。
- 在文件存在时自动加载 `~/.codex/AGENTS.md`。
- 为 Planner、Implementer、Reviewer、Merger 分别配置模型和 reasoning effort。
- 将 Issue 入口固定为 open + `ready-for-agent`。
- 使用本仓库的 Dockerfile 和运行编排。

因此 `.sandcastle/main.mts` 仍由上游生成并保留，但本工具的 `run` 使用包内定制编排。
这部分覆盖是为了表达上游参数暂时无法表达的宿主认证和阶段模型能力。

## `baseUrl` 是什么

默认值是：

```text
http://host.docker.internal:15721/v1
```

它是容器内 Codex 使用的模型 provider API 根地址，不是 Sandcastle 服务地址：

```text
容器内 Codex -> host.docker.internal:15721 -> 宿主机本地网关 -> 实际模型 provider
```

- `host.docker.internal` 让 Docker 容器访问宿主机。
- `15721` 是本仓库默认假定的宿主机 cc-switch 兼容网关端口。
- `/v1` 是兼容 Responses API 的根路径。

只有宿主机确实在该端口运行兼容网关时才能使用默认值。使用官方 endpoint 或其他本地
端口时，在初始化或后续配置中覆盖：

```bash
npx github:liumingjian/sandcastle-for-agent configure \
  --base-url https://api.openai.com/v1 \
  --build
```

容器中的 `127.0.0.1` 和 `localhost` 指向容器自身，不能用它们访问宿主服务。

## 后续配置与命令

```bash
sandcastle-for-agent init
sandcastle-for-agent configure
sandcastle-for-agent build
sandcastle-for-agent run
```

- `init`：完成前置检查、上游初始化、定制配置和镜像构建；只用于尚无
  `.sandcastle` 的仓库。
- `configure`：更新已有 Harness 的受管文件和模型配置，不重新安装依赖，不创建标签。
- `build`：重新构建 `.sandcastle/Dockerfile` 对应的镜像。
- `run`：完成认证、标签和镜像检查后运行四阶段工作流。

`init` 默认构建镜像。只在 CI 或诊断场景中使用 `--no-build`，之后必须单独执行
`build`。完整高级参数可通过以下命令查看：

```bash
npx github:liumingjian/sandcastle-for-agent --help
```

## 生成或覆盖的文件

```text
package.json
package-lock.json
.sandcastle/
├── .env.example
├── .gitignore
├── CODING_STANDARDS.md
├── Dockerfile
├── codex-config.toml
├── for-agent.json
├── main.mts
└── *-prompt.md
```

已有 `package.json` 会保留并增加精确版本的开发依赖。`configure` 会覆盖本工具管理的
配置和 prompt，但保留上游生成的 `main.mts` 与用户已有的 `.env`。

`.sandcastle/.env` 不允许声明 `OPENAI_API_KEY`、`OPENAI_KEY` 或 `CODEX_API_KEY`；
本工具只复用宿主 Codex 认证。

## 当前限制

- 当前只支持 Codex + Docker + GitHub Issues。
- 初始化依赖 npm；目标仓库使用其他包管理器时会额外生成 `package-lock.json`。
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

上游版本升级需要显式修改固定版本，并重新验证初始化输出与覆盖文件。
