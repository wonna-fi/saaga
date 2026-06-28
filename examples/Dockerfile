# Example: self-contained Docker image that runs saaga against a
# mounted application directory. Adapt to your own registry / base image.
#
# Build:  docker build -f examples/Dockerfile -t my-saaga .
# Run:    docker run --rm -v /path/to/app:/workspace \
#             my-saaga --backend cursor init /workspace
FROM node:22-bookworm

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        git \
        jq \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install the agent backends you want available at runtime.
# Replace these RUN lines (or comment out) to match your needs.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN curl https://cursor.com/install -fsS | bash \
    && /root/.local/bin/cursor-agent --version
ENV PATH="/root/.local/bin:${PATH}"

# (Optional) Copilot CLI:
# RUN curl -fsSL https://gh.io/copilot-install | bash && copilot version

WORKDIR /opt/saaga
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY dist ./dist
COPY flows ./flows
COPY prompts ./prompts

RUN ln -s /opt/saaga/dist/cli.js /usr/local/bin/saaga && \
    chmod +x /opt/saaga/dist/cli.js

WORKDIR /workspace
ENTRYPOINT ["saaga"]
