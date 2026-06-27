import type { task_tool } from "../types.js";

// Seed task tools. Tool ids are the contract; descriptions are when-to-use guidance.
// All requires_confirmation are false (no current seed tool submits a form).
export const seed_tools: task_tool[] = [
  {
    tool_definition: {
      name: "check_collection_schedule",
      description:
        "Use when the resident asks when trash, recycling, or yard-waste collection happens. Resolves to the resident's saved address automatically.",
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    downstream: "ap-civic",
    operation: "check_collection_schedule",
    requires_confirmation: false,
  },
  {
    tool_definition: {
      name: "check_power_status",
      description:
        "Use when the resident asks about power, outages, or whether their electricity service is on. Resolves to the resident's saved address automatically; no input is needed.",
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    downstream: "ap-utility",
    operation: "check_power_status",
    requires_confirmation: false,
  },
  {
    tool_definition: {
      name: "check_city_alerts",
      description:
        "Use when the resident asks about active city alerts, advisories, or emergency notices.",
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    downstream: "ap-civic",
    operation: "check_city_alerts",
    requires_confirmation: false,
  },
  {
    tool_definition: {
      name: "read_utility_bill",
      description:
        "Use when the resident asks about their utility bill, balance due, or recent usage.",
      input_schema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Utility account identifier." },
        },
        required: [],
      },
    },
    downstream: "ap-utility",
    operation: "read_utility_bill",
    requires_confirmation: false,
  },
  {
    tool_definition: {
      name: "check_city_events",
      description:
        "Use when the resident asks about upcoming city events, meetings, or community activities.",
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    downstream: "ap-civic",
    operation: "check_city_events",
    requires_confirmation: false,
  },
  {
    tool_definition: {
      name: "set_reminder",
      description:
        "Use when the resident asks to be reminded about something at a specific time, e.g. 'remind me two days before my bill is due'. Resolve the time to an absolute ISO 8601 instant.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short reminder title." },
          body: { type: "string", description: "Reminder detail shown to the resident." },
          scheduled_at: {
            type: "string",
            description: "ISO 8601 instant the reminder should fire.",
          },
        },
        required: ["title", "body", "scheduled_at"],
      },
    },
    downstream: "ap-reminders",
    operation: "set_reminder",
    requires_confirmation: false,
  },
  {
    tool_definition: {
      name: "my_area",
      description:
        "Use when the resident asks which school or neighborhood service area they belong to. Resolves to the resident's saved address automatically.",
      input_schema: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["school", "neighborhood"],
            description: "Which service area to resolve.",
          },
        },
        required: ["kind"],
      },
    },
    downstream: "ap-civic",
    operation: "my_area",
    requires_confirmation: false,
  },
];
