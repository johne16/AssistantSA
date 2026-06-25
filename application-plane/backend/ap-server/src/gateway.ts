// Express REST gateway. Verifies the tenant_context_token RS256 signature at the
// edge for every client request, then routes to the owning module handler.
// Routes and payloads match the resident-mobile gateway clients exactly.
//
//   POST /civic                    -> ap-civic.civic_read
//   POST /utility/site-script      -> ap-utility.script_read
//   POST /utility/bill-push        -> ap-utility.bill_push
//   POST /utility/read             -> ap-utility.utility_read
//   POST /utility/profile          -> ap-utility.save_profile
//   POST /utility/profile/read     -> ap-utility.get_profile
//   POST /utility/accounts         -> ap-utility.link_account
//   POST /utility/accounts/read    -> ap-utility.list_linked_accounts
//   POST /utility/accounts/unlink  -> ap-utility.unlink_account
//   POST /assistant/query (SSE)    -> ap-assistant.assistant_query

import express, { type Request, type Response } from "express";

import type { civic_handler, civic_resource, my_area_kind } from "ap-civic";
import type {
  linked_account,
  resident_profile,
  utility_handler,
  utility_resource,
} from "ap-utility";
import type { assistant_handler } from "ap-assistant";

import type { tenant_claims, token_verifier } from "./adapters/token.js";

export interface gateway_modules {
  civic: civic_handler;
  utility: utility_handler;
  assistant: assistant_handler;
  token_verifier: token_verifier;
}

// Pull the token off the request body or Authorization: Bearer header.
function token_from(req: Request): string | undefined {
  const body_token = (req.body as { tenant_context_token?: unknown })?.tenant_context_token;
  if (typeof body_token === "string" && body_token) return body_token;
  const auth = req.header("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return undefined;
}

export function create_gateway(modules: gateway_modules): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const { token_verifier } = modules;

  // Edge auth: pull the token, verify its RS256 signature, and return the token
  // plus decoded claims. Sends 401 itself and returns null on missing/invalid
  // token so callers can distinguish auth failures from downstream work errors.
  async function authenticate(
    req: Request,
    res: Response,
  ): Promise<{ token: string; claims: tenant_claims } | null> {
    const token = token_from(req);
    if (!token) {
      res.status(401).json({ error: "missing_token" });
      return null;
    }
    try {
      const claims = await token_verifier.verify(token);
      return { token, claims };
    } catch (err) {
      console.error("[ap-server] token verification failed:", err);
      res.status(401).json({ error: "unauthorized", detail: message_of(err) });
      return null;
    }
  }

  // A downstream module/store failure: the request authenticated but the work
  // could not complete.
  function fail(res: Response, err: unknown): void {
    console.error("[ap-server] request failed:", err);
    res.status(500).json({ error: "internal_error", detail: message_of(err) });
  }

  // POST /civic { tenant_context_token, operation, params }
  app.post("/civic", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const { claims } = auth;
      const { operation, params } = req.body as {
        operation: civic_resource;
        params: { address?: string; kind?: my_area_kind };
      };
      const result = await modules.civic.civic_read(operation, params ?? {}, {
        sub: claims.sub,
        city_tenant_id: claims.city_tenant_id,
        iat: claims.iat,
        exp: claims.exp,
      });
      res.json(result);
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /utility/site-script { tenant_context_token, site_id }
  app.post("/utility/site-script", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const { claims } = auth;
      const { site_id } = req.body as { site_id: string };
      const entry = modules.utility.script_read(site_id, {
        sub: claims.sub,
        city_tenant_id: claims.city_tenant_id,
      });
      if (!entry) return res.status(404).json({ error: "unknown_site" });
      res.json(entry);
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /utility/bill-push { tenant_context_token, bills, usage }
  app.post("/utility/bill-push", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const { claims } = auth;
      const { bills, usage } = req.body as { bills?: unknown[]; usage?: unknown[] };
      await modules.utility.bill_push(
        { bills: (bills ?? []) as never, usage: (usage ?? []) as never },
        { sub: claims.sub, city_tenant_id: claims.city_tenant_id },
      );
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /utility/read { tenant_context_token, operation, params }
  app.post("/utility/read", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const { claims } = auth;
      const { operation, params } = req.body as {
        operation: utility_resource;
        params: { account_ref?: string };
      };
      const result = await modules.utility.utility_read(operation, params ?? {}, {
        sub: claims.sub,
        city_tenant_id: claims.city_tenant_id,
      });
      res.json(result);
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /utility/profile { tenant_context_token, profile }
  app.post("/utility/profile", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const { claims } = auth;
      const { profile } = req.body as { profile: resident_profile };
      await modules.utility.save_profile(profile, {
        sub: claims.sub,
        city_tenant_id: claims.city_tenant_id,
      });
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /utility/profile/read { tenant_context_token } -> profile | null
  app.post("/utility/profile/read", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const { claims } = auth;
      const profile = await modules.utility.get_profile({
        sub: claims.sub,
        city_tenant_id: claims.city_tenant_id,
      });
      res.json(profile);
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /utility/accounts { tenant_context_token, account }
  app.post("/utility/accounts", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const { claims } = auth;
      const { account } = req.body as { account: linked_account };
      await modules.utility.link_account(account, {
        sub: claims.sub,
        city_tenant_id: claims.city_tenant_id,
      });
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /utility/accounts/read { tenant_context_token } -> linked_account[]
  app.post("/utility/accounts/read", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const { claims } = auth;
      const accounts = await modules.utility.list_linked_accounts({
        sub: claims.sub,
        city_tenant_id: claims.city_tenant_id,
      });
      res.json(accounts);
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /utility/accounts/unlink { tenant_context_token, site_id }
  app.post("/utility/accounts/unlink", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    try {
      const { claims } = auth;
      const { site_id } = req.body as { site_id: string };
      await modules.utility.unlink_account(site_id, {
        sub: claims.sub,
        city_tenant_id: claims.city_tenant_id,
      });
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  // POST /assistant/query -> SSE stream of { type: "token", data: { text } }.
  app.post("/assistant/query", async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { token } = auth;

    // SSE headers; flush so the client opens the stream immediately.
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders();

    const { message } = req.body as { message: string };
    try {
      for await (const chunk of modules.assistant.assistant_query({
        tenant_context_token: token,
        message,
      })) {
        write_sse(res, "token", JSON.stringify({ text: chunk.text }));
      }
      write_sse(res, "done", "{}");
    } catch (err) {
      write_sse(res, "error", JSON.stringify({ message: message_of(err) }));
    } finally {
      res.end();
    }
  });

  return app;
}

// One SSE event frame: named event + JSON data line.
function write_sse(res: Response, event: string, data: string): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

function message_of(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
