import js from "@eslint/js";
import pluginNext from "@next/eslint-plugin-next";
import eslintConfigPrettier from "eslint-config-prettier";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import { config as baseConfig } from "./base.js";

/**
 * A custom ESLint configuration for libraries that use Next.js.
 *
 * @type {import("eslint").Linter.Config}
 * */
export const nextJsConfig = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // React scope no longer necessary with new JSX transform.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@avgeek-oss/design-system/layouts/page",
              importNames: ["Page"],
              message:
                "Use a page archetype from @avgeek-oss/design-system/patterns/pages/page.",
            },
            {
              name: "@avgeek-oss/design-system/navigation/breadcrumbs",
              importNames: ["Breadcrumbs"],
              message:
                "Breadcrumbs are owned by the title lead in @avgeek-oss/design-system/patterns/pages/page.",
            },
          ],
        },
      ],
      // Prevent nested interactive elements (Button inside Link/a)
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXElement[openingElement.name.name=/^(Link|a)$/] > JSXElement[openingElement.name.name='Button']",
          message:
            "Do not nest <Button> inside <Link> or <a>. Use <Button render={<Link href='...' />}> instead.",
        },
      ],
      // Require rel="noopener noreferrer" on target="_blank" links
      "react/jsx-no-target-blank": [
        "error",
        {
          allowReferrer: false,
          enforceDynamicLinks: "always",
        },
      ],
      // Disallow console.log in production code (allow warn, error, info)
      "no-console": [
        "error",
        {
          allow: ["warn", "error", "info"],
        },
      ],
      // Use <Link> instead of <a> for internal navigation
      "@next/next/no-html-link-for-pages": "error",
    },
  },
  {
    files: ["**/src/components/page-parts.tsx"],
    rules: {
      // DashboardPage also hosts library patterns that supply their own heading.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@avgeek-oss/design-system/navigation/breadcrumbs",
              importNames: ["Breadcrumbs"],
              message:
                "Register breadcrumbs through the application page wrapper.",
            },
          ],
        },
      ],
    },
  },
];
