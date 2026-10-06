FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS source
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./

FROM source AS runtime
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
