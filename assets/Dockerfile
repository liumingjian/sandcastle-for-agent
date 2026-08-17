FROM node:22-bookworm

RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

ARG AGENT_UID=1000
ARG AGENT_GID=1000

RUN groupmod -o -g $AGENT_GID node \
  && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node \
  && install -d -o $AGENT_UID -g $AGENT_GID /home/agent/.codex

RUN npm install --include=optional -g @openai/codex \
  && codex_root="$(npm root -g)/@openai/codex" \
  && codex_version="$(node -p 'require(process.argv[1]).version' "$codex_root/package.json")" \
  && case "$(dpkg --print-architecture)" in \
       arm64) codex_platform="linux-arm64" ;; \
       amd64) codex_platform="linux-x64" ;; \
       *) echo "Unsupported Docker architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
     esac \
  && npm install --prefix "$codex_root" --no-save --package-lock=false \
       "@openai/codex-${codex_platform}@npm:@openai/codex@${codex_version}-${codex_platform}" \
  && codex --version

USER ${AGENT_UID}:${AGENT_GID}
WORKDIR /home/agent

ENTRYPOINT ["sleep", "infinity"]
