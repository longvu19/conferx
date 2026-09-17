FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies first to leverage layer caching.
COPY package.json ./
RUN bun install

COPY . .

USER bun
EXPOSE 3001
CMD ["bun", "run", "start"]
