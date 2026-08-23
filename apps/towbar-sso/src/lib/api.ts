import { createTowbarClient } from "@workspace/towbar-web-client";
import { config } from "./config";
export const api = createTowbarClient({ baseUrl: config.apiBaseUrl });
