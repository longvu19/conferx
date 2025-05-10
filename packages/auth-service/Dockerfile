FROM node:22 AS development
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run dev
FROM node:22 AS production
WORKDIR /app
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
COPY package*.json ./
RUN npm ci --only=production
COPY --from=development /app/dist ./dist
CMD ["node", "dist/index.js"]