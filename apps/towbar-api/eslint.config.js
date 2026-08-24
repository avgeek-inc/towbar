import { config } from "@workspace/eslint-config/backend";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    files: ["src/areas/apps/service.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../sources/*", "../sources/**"],
              message:
                "Deployment admission must use the latest synchronized snapshot. Synchronize Sources through the dedicated Source workflow.",
            },
          ],
        },
      ],
    },
  },
  { ignores: ["dist/**"] },
];
