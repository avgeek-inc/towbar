import { config } from "@workspace/eslint-config/backend";

/** @type {import("eslint").Linter.Config} */
export default [...config, { ignores: ["dist/**"] }];
