// ap-utility handler: maps gateway, assistant, and scheduler inputs to the service.

import { create_utility_service, type utility_read_result } from "./service.js";
import type {
  agent_list_linked_accounts_request,
  agent_request,
  bill_push,
  linked_account,
  provider_catalog_entry,
  resident_profile,
  scrape_script_entry,
  tenant_claims,
  tenant_context_token,
  utility_handler_deps,
  utility_read_params,
  utility_resource,
} from "./types.js";

export interface utility_handler {
  // Gateway: token already validated by the gateway; claims supplied by ap-server.
  utility_read(
    resource: utility_resource,
    params: utility_read_params,
    claims: tenant_claims,
  ): Promise<utility_read_result>;
  bill_push(request: bill_push, claims: tenant_claims): Promise<void>;
  script_read(site_id: string, claims: tenant_claims): scrape_script_entry | undefined;
  catalog_read(claims: tenant_claims): provider_catalog_entry[];
  save_profile(profile: resident_profile, claims: tenant_claims): Promise<void>;
  get_profile(claims: tenant_claims): Promise<resident_profile | null>;
  link_account(account: linked_account, claims: tenant_claims): Promise<void>;
  list_linked_accounts(claims: tenant_claims): Promise<linked_account[]>;
  unlink_account(site_id: string, claims: tenant_claims): Promise<void>;
  // Assistant: RS256-verify the forwarded token, never bare claims.
  agent_request(request: agent_request): Promise<utility_read_result>;
  agent_list_linked_accounts(
    request: agent_list_linked_accounts_request,
  ): Promise<provider_catalog_entry[]>;
  // Scheduler.
  run_outage_fetch(): Promise<void>;
  run_reminder_evaluation(): Promise<void>;
}

export function create_utility_handler(deps: utility_handler_deps): utility_handler {
  const service = create_utility_service(deps);
  const { token_verifier } = deps;

  // Log any error to the console with the module tag, then rethrow so callers
  // still see it.
  function with_logging<T>(op: string, fn: () => Promise<T>): Promise<T> {
    return fn().catch((err) => {
      console.error(`[ap-utility] ${op} failed:`, err);
      throw err;
    });
  }

  // Build a token shape from gateway-validated claims for service scoping.
  function token_from_claims(claims: tenant_claims): tenant_context_token {
    return { sub: claims.sub, city_tenant_id: claims.city_tenant_id, iat: 0, exp: 0 };
  }

  async function utility_read(
    resource: utility_resource,
    params: utility_read_params,
    claims: tenant_claims,
  ): Promise<utility_read_result> {
    return with_logging("utility_read", () =>
      service.read(token_from_claims(claims), resource, params),
    );
  }

  async function bill_push(request: bill_push, claims: tenant_claims): Promise<void> {
    await with_logging("bill_push", () =>
      service.push(token_from_claims(claims), request),
    );
  }

  function script_read(
    site_id: string,
    _claims: tenant_claims,
  ): scrape_script_entry | undefined {
    try {
      return service.script(site_id);
    } catch (err) {
      console.error("[ap-utility] script_read failed:", err);
      throw err;
    }
  }

  async function save_profile(
    profile: resident_profile,
    claims: tenant_claims,
  ): Promise<void> {
    await with_logging("save_profile", () =>
      service.save_profile(token_from_claims(claims), profile),
    );
  }

  async function get_profile(
    claims: tenant_claims,
  ): Promise<resident_profile | null> {
    return with_logging("get_profile", () =>
      service.get_profile(token_from_claims(claims)),
    );
  }

  async function link_account(
    account: linked_account,
    claims: tenant_claims,
  ): Promise<void> {
    await with_logging("link_account", () =>
      service.link_account(token_from_claims(claims), account),
    );
  }

  async function list_linked_accounts(
    claims: tenant_claims,
  ): Promise<linked_account[]> {
    return with_logging("list_linked_accounts", () =>
      service.list_linked_accounts(token_from_claims(claims)),
    );
  }

  async function unlink_account(
    site_id: string,
    claims: tenant_claims,
  ): Promise<void> {
    await with_logging("unlink_account", () =>
      service.unlink_account(token_from_claims(claims), site_id),
    );
  }

  async function agent_request(request: agent_request): Promise<utility_read_result> {
    return with_logging("agent_request", async () => {
      // Local RS256 signature verification; rejects on bad signature or expiry.
      const token = await token_verifier.verify(request.tenant_context_token);
      return service.read(token, request.operation, request.params);
    });
  }

  function catalog_read(_claims: tenant_claims): provider_catalog_entry[] {
    return service.catalog();
  }

  // The resident's linked accounts joined with the provider catalog, so the
  // assistant sees each account's service_kind alongside its site_id.
  async function agent_list_linked_accounts(
    request: agent_list_linked_accounts_request,
  ): Promise<provider_catalog_entry[]> {
    return with_logging("agent_list_linked_accounts", async () => {
      const token = await token_verifier.verify(request.tenant_context_token);
      const linked = await service.list_linked_accounts(token);
      const catalog = service.catalog();
      return linked.map((a) => {
        const entry = catalog.find((c) => c.site_id === a.site_id);
        return entry ?? { site_id: a.site_id, provider: a.provider, service_kind: "" };
      });
    });
  }

  async function run_outage_fetch(): Promise<void> {
    await with_logging("run_outage_fetch", () => service.run_outage_fetch());
  }

  async function run_reminder_evaluation(): Promise<void> {
    await with_logging("run_reminder_evaluation", () =>
      service.run_reminder_evaluation(),
    );
  }

  return {
    utility_read,
    bill_push,
    script_read,
    catalog_read,
    save_profile,
    get_profile,
    link_account,
    list_linked_accounts,
    unlink_account,
    agent_request,
    agent_list_linked_accounts,
    run_outage_fetch,
    run_reminder_evaluation,
  };
}
