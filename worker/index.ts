import { routeAgentRequest } from "agents/routing";

export { GameplayAgent } from "./GameplayAgent.ts";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const gameplayRoute = /^\/agents\/gameplay-agent\/[a-f0-9-]{36}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/agents/")) {
      if (!import.meta.env?.DEV || !localHosts.has(url.hostname) || !gameplayRoute.test(url.pathname)) {
        return new Response(null, { status: 404 });
      }
      if (request.headers.get("Origin") !== url.origin) {
        return new Response(null, { status: 403 });
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response(null, { status: 426 });
      }
      return (await routeAgentRequest(request, env)) ?? new Response(null, { status: 404 });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({
        name: "Cloudflare",
      });
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
