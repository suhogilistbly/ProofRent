import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../server/index.js";

export default function handler(request: IncomingMessage, response: ServerResponse) {
  return app(request, response);
}
