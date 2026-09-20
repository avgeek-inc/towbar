import { resolveRepositoryEnvironment } from "@workspace/towbar-core";

export function connectionManifestFiles(serverIp: string) {
  return [
    {
      path: "towbar.yml",
      content:
        "version: 2\nenvironments:\n  production: {}\n  staging:\n    previews:\n      enabled: true\n",
    },
    {
      path: ".towbar/apps/service.app.yml",
      content: `id: service
name: Example Service
dockerfile: Dockerfile
container:
  port: 3000
secrets:
  build: [NPM_TOKEN]
  runtime: [DATABASE_URL]
tls:
  mode: direct
preview:
  enabled: true
  domain: preview.example.com
  ttlHours: 72
environments:
  production:
    server: ${serverIp}
    domains:
      primary: service.example.com
  staging:
    server: ${serverIp}
    domains:
      primary: staging.service.example.com
`,
    },
    {
      path: ".towbar/resources/database.resource.yml",
      content: `id: database
name: Service Database
type: postgres
secrets:
  runtime: [POSTGRES_PASSWORD]
environments:
  production:
    server: ${serverIp}
  staging:
    server: ${serverIp}
`,
    },
  ];
}

export function resolveConnectionManifest(
  serverIp: string,
  environment: string,
  branch: string,
) {
  const [root, ...files] = connectionManifestFiles(serverIp);
  return resolveRepositoryEnvironment({
    root: root!.content,
    files,
    environment,
    branch,
  }).manifest;
}
