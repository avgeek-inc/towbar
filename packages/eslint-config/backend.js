import { config as baseConfig } from "./base.js";
import globals from "globals";

const routeDatabaseAccessMessage =
  "Route files must stay thin: move Drizzle schema/query access into the owning module or service and import that boundary instead.";

const routeDatabaseAccessAllowlist = [
  "src/routes/v1/admin/identity-audit-logs.ts",
  "src/routes/v1/admin/identity-notifications.ts",
  "src/routes/v1/admin/identity-sessions.ts",
  "src/routes/v1/admin/identity-tokens.ts",
  "src/routes/v1/admin/identity-users.ts",
  "src/routes/v1/admin/provider-metrics.ts",
  "src/routes/v1/core/account.ts",
  "src/routes/v1/core/fcm-tokens.ts",
  "src/routes/v1/core/identity-profile.ts",
  "src/routes/v1/core/identity-sessions.ts",
  "src/routes/v1/core/integrations.ts",
  "src/routes/v1/core/notifications.ts",
  "src/routes/v1/core/settings.ts",
  "src/routes/v1/public/auth.ts",
];

const oversizedBackendFileAllowlist = [
  "src/helpers/data-schemas.ts",
  "src/integrations/cloudflare/ai-gateway.ts",
  "src/integrations/flightaware/flights.ts",
  "src/modules/admin/schemas.ts",
  "src/modules/admin/service.ts",
  "src/modules/flight/flight.service.ts",
  "src/modules/flight/wallet-pass/service.ts",
  "src/routes/v1/core/account.ts",
  "src/routes/v1/public/auth.ts",
  "src/temporal/aircraft-registrations/adapters/ARM/index.ts",
  "src/temporal/aircraft-registrations/adapters/CHE/index.ts",
  "src/temporal/aircraft-registrations/adapters/CHN/index.ts",
  "src/temporal/aircraft-registrations/adapters/ESP/index.ts",
  "src/temporal/aircraft-registrations/adapters/GBR/index.ts",
  "src/temporal/aircraft-registrations/adapters/IDN/index.ts",
  "src/temporal/aircraft-registrations/adapters/LKA/index.ts",
  "src/temporal/aircraft-registrations/adapters/MLT/index.ts",
  "src/temporal/aircraft-registrations/adapters/MNG/index.ts",
  "src/temporal/aircraft-registrations/adapters/SVN/index.ts",
  "src/temporal/aircraft-registrations/upsert.ts",
  "src/temporal/airline-points/adapters/AIC/index.ts",
  "src/temporal/airline-points/adapters/ANA/index.ts",
  "src/temporal/airline-points/adapters/CPA/index.ts",
  "src/temporal/airline-points/adapters/ETD/index.ts",
  "src/temporal/airline-points/adapters/JAL/index.ts",
  "src/temporal/airline-points/adapters/QTR/index.ts",
  "src/temporal/airline-points/adapters/SIA/index.ts",
  "src/temporal/airline-points/edge.ts",
  "src/temporal/airline-points/helpers/group-airlines/qfa/index.ts",
  "src/temporal/airline-points/service.ts",
  "src/temporal/airline-profile/search.ts",
  "src/temporal/airline-profile/service.ts",
  "src/temporal/airport-catalog/service.ts",
  "src/temporal/airport-profile/search.ts",
  "src/temporal/airport-profile/service.ts",
  "src/temporal/airport-weather/service.ts",
  "src/temporal/automation-categories/core.ts",
  "src/temporal/automation-runs/service.ts",
];

const complexBackendFileAllowlist = [
  "src/activities/flight/flight-track.activities.ts",
  "src/integrations/checkwx/weather.ts",
  "src/integrations/cirium/flights.ts",
  "src/integrations/cloudflare/ai-gateway.ts",
  "src/integrations/flightaware/flights.ts",
  "src/integrations/visualcrossing/weather.ts",
  "src/modules/admin/service.ts",
  "src/modules/flight/flight.service.ts",
  "src/modules/flight/wallet-pass/service.ts",
  "src/modules/user/settings/settings.service.ts",
  "src/temporal/aircraft-registrations/adapters/CHE/index.ts",
  "src/temporal/aircraft-registrations/adapters/CZE/index.ts",
  "src/temporal/aircraft-registrations/adapters/GBR/index.ts",
  "src/temporal/aircraft-registrations/adapters/IDN/index.ts",
  "src/temporal/aircraft-registrations/adapters/MDA/index.ts",
  "src/temporal/aircraft-registrations/adapters/MDV/index.ts",
  "src/temporal/aircraft-registrations/adapters/PNG/index.ts",
  "src/temporal/aircraft-registrations/adapters/SUR/index.ts",
  "src/temporal/airline-points/adapters/JAL/index.ts",
  "src/temporal/airline-points/helpers/process.ts",
  "src/temporal/airline-profile/fields.ts",
  "src/temporal/airport-weather/service.ts",
  "src/temporal/automation-runs/service.ts",
  "src/workflows/automation/automation-coordinator.workflow.ts",
  "src/workflows/flight/flight-route.workflow.ts",
];

const maintainabilityPlugin = {
  rules: {
    "require-eslint-disable-justification": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Require eslint-disable comments to name rules and include a justification.",
        },
        messages: {
          broadDisable:
            "ESLint disable comments must name the specific rule being disabled.",
          missingJustification:
            "ESLint disable comments must include a justification after `--`.",
        },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();

        return {
          Program() {
            for (const comment of sourceCode.getAllComments()) {
              const text = comment.value.trim();
              const directiveMatch = text.match(
                /^eslint-disable(?:-next-line|-line)?\b/,
              );

              if (!directiveMatch) continue;

              const [directiveText, justification = ""] = text.split(
                /\s--\s+/,
                2,
              );
              const ruleText = directiveText
                .slice(directiveMatch[0].length)
                .trim();
              const ruleNames = ruleText
                .split(",")
                .map((ruleName) => ruleName.trim())
                .filter(Boolean);

              if (ruleNames.length === 0) {
                context.report({
                  loc: comment.loc,
                  messageId: "broadDisable",
                });
              }

              if (justification.trim().length === 0) {
                context.report({
                  loc: comment.loc,
                  messageId: "missingJustification",
                });
              }
            }
          },
        };
      },
    },
  },
};

/**
 * A shared ESLint configuration for backend applications.
 *
 * @type {import("eslint").Linter.Config}
 * */
export const config = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      "prefer-promise-reject-errors": "off",
      "require-await": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          disallowTypeAnnotations: false,
          fixStyle: "separate-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          ignoreIIFE: false,
          // Require an explicit `void` marker for intentional fire-and-forget work.
          ignoreVoid: true,
        },
      ],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/require-await": "error",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      maintainability: maintainabilityPlugin,
    },
    rules: {
      complexity: ["error", { max: 25 }],
      "max-lines": [
        "error",
        { max: 600, skipBlankLines: true, skipComments: true },
      ],
      "sort-imports": [
        "error",
        {
          allowSeparatedGroups: true,
          ignoreCase: false,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ["none", "all", "multiple", "single"],
        },
      ],
      "maintainability/require-eslint-disable-justification": "error",
    },
  },
  {
    files: oversizedBackendFileAllowlist,
    rules: {
      "max-lines": "off",
    },
  },
  {
    files: complexBackendFileAllowlist,
    rules: {
      complexity: "off",
    },
  },
  {
    files: ["src/routes/**/*.ts", "src/routes/**/*.tsx"],
    ignores: routeDatabaseAccessAllowlist,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "drizzle-orm",
              message: routeDatabaseAccessMessage,
            },
          ],
          patterns: [
            {
              group: ["drizzle-orm/*"],
              message: routeDatabaseAccessMessage,
            },
          ],
        },
      ],
    },
  },
];
