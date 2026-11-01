FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY tsconfig.json ./
USER node
EXPOSE 3000
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/service/main.ts"]
