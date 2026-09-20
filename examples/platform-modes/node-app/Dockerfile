FROM node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 AS source
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./

FROM source AS runtime
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
