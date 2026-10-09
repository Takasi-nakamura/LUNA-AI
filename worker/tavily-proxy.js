/**
 * Cloudflare Worker proxy for Tavily Search API.
 *
 * Setup:
 * 1. Deploy this file as a Cloudflare Worker.
 * 2. Add a Worker secret named TAVILY_API_KEY in Cloudflare.
 * 3. Set ALLOWED_ORIGIN to the exact GitHub Pages origin, or keep the default.
 *
 * The Tavily API key must only be stored as a Cloudflare secret, never in frontend code.
 */

const DEFAULT_ALLOWED_ORIGIN = "https://takasi-nakamura.github.io";

function corsHeaders(origin, allowedOrigin) {
  const permittedOrigin = origin === allowedOrigin ? origin : allowedOrigin;
  return {
    "Access-Control-Allow-Origin": permittedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (origin !== allowedOrigin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin, allowedOrigin),
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (origin && origin !== allowedOrigin) {
      return json({ error: "Origin not allowed" }, 403, corsHeaders(origin, allowedOrigin));
    }

    const url = new URL(request.url);
    if (url.pathname !== "/search") {
      return json({ error: "Not found" }, 404, corsHeaders(origin, allowedOrigin));
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsHeaders(origin, allowedOrigin));
    }

    if (!env.TAVILY_API_KEY) {
      return json({ error: "Cloudflare Worker secret TAVILY_API_KEY is not configured" }, 500, corsHeaders(origin, allowedOrigin));
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON" }, 400, corsHeaders(origin, allowedOrigin));
    }

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return json({ error: "query is required" }, 400, corsHeaders(origin, allowedOrigin));
    }
    if (query.length > 1000) {
      return json({ error: "query is too long" }, 400, corsHeaders(origin, allowedOrigin));
    }

    try {
      const upstream = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.TAVILY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          search_depth: body.search_depth === "advanced" ? "advanced" : "basic",
          max_results: Math.min(Math.max(Number(body.max_results) || 5, 1), 10),
          include_answer: false,
        }),
      });

      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return json({
          error: "Tavily search request failed",
          status: upstream.status,
          detail: typeof result.detail === "string" ? result.detail : undefined,
        }, 502, corsHeaders(origin, allowedOrigin));
      }

      const results = Array.isArray(result.results) ? result.results.map((item) => ({
        title: item.title || "",
        url: item.url || "",
        content: item.content || "",
        score: item.score,
      })) : [];

      return json({ query, results }, 200, corsHeaders(origin, allowedOrigin));
    } catch {
      return json({ error: "Unable to reach Tavily Search API" }, 502, corsHeaders(origin, allowedOrigin));
    }
  },
};
