import jsxA11y from "eslint-plugin-jsx-a11y";

const explicitSvgAccessibilityRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require SVG content to be explicitly labelled or hidden from assistive technology.",
    },
    messages: {
      missingAccessibility:
        "SVG content must have aria-hidden, aria-label, or aria-labelledby.",
    },
    schema: [],
  },
  create(context) {
    function getAttributeName(attribute) {
      return attribute.type === "JSXAttribute" &&
        attribute.name.type === "JSXIdentifier"
        ? attribute.name.name
        : undefined;
    }

    function isExplicitlyHidden(attribute) {
      if (getAttributeName(attribute) !== "aria-hidden") return false;
      if (attribute.value === null) return true;

      if (attribute.value.type === "Literal") {
        return attribute.value.value === "true";
      }

      return (
        attribute.value.type === "JSXExpressionContainer" &&
        attribute.value.expression.type === "Literal" &&
        attribute.value.expression.value === true
      );
    }

    function hasNonEmptyLabel(attribute) {
      const name = getAttributeName(attribute);
      if (name !== "aria-label" && name !== "aria-labelledby") return false;
      if (attribute.value === null) return false;

      return (
        attribute.value.type !== "Literal" ||
        String(attribute.value.value ?? "").trim().length > 0
      );
    }

    function hasAccessibilityAttribute(node) {
      return node.attributes.some(
        (attribute) =>
          isExplicitlyHidden(attribute) || hasNonEmptyLabel(attribute),
      );
    }

    function isInsideHiddenContent(node) {
      let parent = node.parent;

      while (parent) {
        if (
          parent.type === "JSXElement" &&
          parent.openingElement.attributes.some(isExplicitlyHidden)
        ) {
          return true;
        }

        parent = parent.parent;
      }

      return false;
    }

    return {
      JSXOpeningElement(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          (node.name.name !== "svg" && node.name.name !== "HugeiconsIcon")
        ) {
          return;
        }

        if (hasAccessibilityAttribute(node) || isInsideHiddenContent(node)) {
          return;
        }

        context.report({
          node,
          messageId: "missingAccessibility",
        });
      },
    };
  },
};

const workspaceAccessibilityPlugin = {
  meta: { name: "@workspace/accessibility" },
  rules: {
    "explicit-svg-accessibility": explicitSvgAccessibilityRule,
  },
};

/** @type {import("eslint").Linter.Config[]} */
export const accessibilityConfig = [
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ["src/**/*.tsx"],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "jsx-a11y/no-autofocus": ["error", { ignoreNonDOM: true }],
    },
  },
  {
    files: ["src/**/*.tsx"],
    plugins: {
      "workspace-a11y": workspaceAccessibilityPlugin,
    },
    rules: {
      "workspace-a11y/explicit-svg-accessibility": "error",
    },
  },
];
