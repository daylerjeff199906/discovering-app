import { HttpClient, type ClientOptions } from "./http";
import { createApi } from "./endpoints";

export * from "./http";
export * from "./endpoints";
export * from "./upload";

export function createApiClient(opts: ClientOptions = {}) {
  const http = new HttpClient(opts);
  return { http, api: createApi(http) };
}
