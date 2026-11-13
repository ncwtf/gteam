FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app

FROM base AS builder
COPY . .
# Install only the server and its workspace deps (incl. devDeps such as typescript)
RUN pnpm install --frozen-lockfile --filter "@gteam/server..."
RUN pnpm --filter "@gteam/server..." build
# Drop devDependencies for a lean runtime
RUN rm -rf node_modules apps/server/node_modules packages/shared/node_modules \
 && pnpm install --frozen-lockfile --prod --filter "@gteam/server..."

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app ./

EXPOSE 3000 3001
CMD ["node", "apps/server/dist/index.js"]
