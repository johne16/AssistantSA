import type { llm_tool_definition, task_tool, tool_registry } from "./types.js";

// In-memory tool registry. Entries register and deregister without touching core or dispatcher.
class registry_impl implements tool_registry {
  private tools = new Map<string, task_tool>();

  constructor(seed: task_tool[]) {
    for (const tool of seed) this.register(tool);
  }

  list(): task_tool[] {
    return [...this.tools.values()];
  }

  get(tool_name: string): task_tool | undefined {
    return this.tools.get(tool_name);
  }

  register(tool: task_tool): void {
    this.tools.set(tool.tool_definition.name, tool);
  }

  deregister(tool_name: string): void {
    this.tools.delete(tool_name);
  }

  // Stable, deterministic order so the cached tool prefix does not shift between turns.
  tool_definitions(): llm_tool_definition[] {
    return this.list()
      .map((t) => t.tool_definition)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function create_tool_registry(seed: task_tool[]): tool_registry {
  return new registry_impl(seed);
}
