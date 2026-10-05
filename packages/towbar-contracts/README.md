# Towbar contracts

Browser-safe DTOs, schemas and shared validation used by the API, worker and dashboard. Import types or a specific module from `@workspace/towbar-contracts`.

Keep Node APIs, deployment parsing, provider clients and filesystem work in `towbar-core`. Core re-exports the existing contract paths for compatibility. The boundary test rejects Node and server-package imports.
