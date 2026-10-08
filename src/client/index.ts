import { AvanzaHttp, type HttpOptions } from "./http.js";
import { endpoints, type Endpoints } from "./endpoints/index.js";

export type AvanzaClient = Endpoints & { http: AvanzaHttp };

/** The typed client, usable as a library on its own (no policy, no output formatting). */
export function createClient(opts: HttpOptions = {}): AvanzaClient {
  const http = new AvanzaHttp(opts);
  return Object.assign(endpoints(http), { http });
}

export { AvanzaHttp } from "./http.js";
export * from "./schemas/index.js";
export { Route, marketGuideType, isFund, type InstrumentDetails, type SearchType, type TransactionType } from "./endpoints/index.js";
