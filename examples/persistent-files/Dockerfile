FROM node:26-alpine
WORKDIR /app
RUN mkdir /app/uploads && chown node:node /app/uploads
COPY --chown=node:node server.mjs ./server.mjs
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
