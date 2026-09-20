#!/usr/bin/env node

/**
 * DayFlow MCP Server
 *
 * Connects Claude to DayFlow task management via Model Context Protocol.
 * Exposes tools: create_task, get_tasks, complete_task, update_task,
 * delete_task, search_tasks.
 *
 * Communicates with DayFlow's Electron API server on localhost:3001.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import http from "node:http";

const DAYFLOW_PORT = process.env.DAYFLOW_PORT || 3001;
const DAYFLOW_HOST = process.env.DAYFLOW_HOST || "127.0.0.1";

// ── HTTP helper ──────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: DAYFLOW_HOST,
      port: DAYFLOW_PORT,
      path,
      method,
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    };
    if (postData) opts.headers["Content-Length"] = Buffer.byteLength(postData);

    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });
    req.on("error", (err) => reject(new Error(`DayFlow not reachable: ${err.message}. Is the app running?`)));
    req.on("timeout", () => { req.destroy(); reject(new Error("DayFlow API timeout — is the app running?")); });
    if (postData) req.write(postData);
    req.end();
  });
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "dayflow",
  version: "1.0.0",
  capabilities: {
    tools: {},
  },
});

// ── Tool: dayflow_create_task ────────────────────────────────────────────────

server.tool(
  "dayflow_create_task",
  "Create a new task in DayFlow. Use natural language (text) for AI parsing, or provide structured fields. Tasks route to 'To Do' or 'Owe Me' columns.",
  {
    text: z.string().optional().describe("Natural language input (e.g. 'Call Mekdi at 7pm today'). DayFlow's AI will parse title, time, date, priority, and category automatically."),
    title: z.string().optional().describe("Task title (used only if 'text' is not provided)"),
    due_date: z.string().optional().describe("Due date in YYYY-MM-DD format"),
    due_time: z.string().optional().describe("Due time in HH:MM (24h) format, e.g. '14:30'"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority (default: medium)"),
    category: z.enum(["todo", "owe_me"]).optional().describe("Which column: 'todo' (default) or 'owe_me'"),
    view: z.enum(["day", "week", "month"]).optional().describe("View scope (default: day)"),
    owed_by: z.string().optional().describe("Person who owes (only for owe_me category)"),
    owed_amount: z.string().optional().describe("Amount owed (only for owe_me category)"),
    notes: z.string().optional().describe("Notes for the task (e.g. agenda items, context, details)"),
  },
  async (args) => {
    try {
      const payload = args.text ? { text: args.text, source: "mcp" } : {
        source: "mcp",
        title: args.title || "Untitled task",
        due_date: args.due_date,
        due_time: args.due_time,
        priority: args.priority || "medium",
        category: args.category || "todo",
        view: args.view || "day",
        owed_by: args.owed_by,
        owed_amount: args.owed_amount,
        notes: args.notes || "",
      };
      const res = await request("POST", "/add-task", payload);
      if (res.data.success) {
        const t = res.data.task;
        return {
          content: [{
            type: "text",
            text: `Task created: "${t.title}"\nSection: ${t.section}\nDate: ${t.dueDate || t.date}\nTime: ${t.dueTime || "none"}\nPriority: ${t.priority}`,
          }],
        };
      }
      return { content: [{ type: "text", text: `Failed: ${res.data.error || "unknown error"}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool: dayflow_get_tasks ──────────────────────────────────────────────────

server.tool(
  "dayflow_get_tasks",
  "Get tasks from DayFlow. Filter by status (open/completed), section (todo/owe_me), or search by keyword.",
  {
    status: z.enum(["open", "completed", "all"]).optional().describe("Filter by task status (default: all)"),
    section: z.enum(["todo", "owe_me"]).optional().describe("Filter by column"),
    q: z.string().optional().describe("Search keyword to filter tasks by title or notes"),
  },
  async (args) => {
    try {
      const params = new URLSearchParams();
      if (args.status && args.status !== "all") params.set("status", args.status);
      if (args.section) params.set("section", args.section);
      if (args.q) params.set("q", args.q);
      const qs = params.toString();
      const res = await request("GET", `/tasks${qs ? "?" + qs : ""}`);
      const tasks = res.data.tasks || [];
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "No tasks found." }] };
      }
      const lines = tasks.map((t, i) => {
        const status = t.completed ? "[x]" : "[ ]";
        const time = t.dueTime ? ` at ${t.dueTime}` : "";
        const date = t.dueDate ? ` (${t.dueDate.split("T")[0]})` : "";
        const priority = t.priority !== "medium" ? ` [${t.priority}]` : "";
        const section = t.section === "owe_me" ? " [Owe Me]" : "";
        return `${i + 1}. ${status} ${t.title}${time}${date}${priority}${section}\n   ID: ${t.id}`;
      });
      return {
        content: [{ type: "text", text: `${tasks.length} task(s):\n\n${lines.join("\n")}` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool: dayflow_complete_task ──────────────────────────────────────────────

server.tool(
  "dayflow_complete_task",
  "Mark a DayFlow task as completed by its ID.",
  {
    id: z.string().describe("The task ID to complete"),
  },
  async (args) => {
    try {
      const res = await request("POST", "/complete-task", { id: args.id });
      if (res.data.success) {
        return { content: [{ type: "text", text: `Task ${args.id} marked as completed.` }] };
      }
      return { content: [{ type: "text", text: `Failed: ${res.data.error || "unknown error"}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool: dayflow_update_task ────────────────────────────────────────────────

server.tool(
  "dayflow_update_task",
  "Update fields on an existing DayFlow task.",
  {
    id: z.string().describe("The task ID to update"),
    title: z.string().optional().describe("New title"),
    due_date: z.string().optional().describe("New due date (YYYY-MM-DD)"),
    due_time: z.string().optional().describe("New due time (HH:MM 24h)"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("New priority"),
    notes: z.string().optional().describe("Task notes"),
  },
  async (args) => {
    try {
      const updates = { id: args.id };
      if (args.title) updates.title = args.title;
      if (args.due_date) updates.dueDate = args.due_date;
      if (args.due_time) updates.dueTime = args.due_time;
      if (args.priority) updates.priority = args.priority;
      if (args.notes !== undefined) updates.notes = args.notes;
      const res = await request("POST", "/update-task", updates);
      if (res.data.success) {
        return { content: [{ type: "text", text: `Task ${args.id} updated.` }] };
      }
      return { content: [{ type: "text", text: `Failed: ${res.data.error || "unknown error"}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool: dayflow_delete_task ────────────────────────────────────────────────

server.tool(
  "dayflow_delete_task",
  "Delete a task from DayFlow by its ID.",
  {
    id: z.string().describe("The task ID to delete"),
  },
  async (args) => {
    try {
      const res = await request("POST", "/delete-task", { id: args.id });
      if (res.data.success) {
        return { content: [{ type: "text", text: `Task ${args.id} deleted.` }] };
      }
      return { content: [{ type: "text", text: `Failed: ${res.data.error || "unknown error"}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool: dayflow_search_tasks ───────────────────────────────────────────────

server.tool(
  "dayflow_search_tasks",
  "Search DayFlow tasks by keyword. Searches titles and notes.",
  {
    query: z.string().describe("Search keyword"),
    status: z.enum(["open", "completed", "all"]).optional().describe("Filter by status (default: all)"),
  },
  async (args) => {
    try {
      const params = new URLSearchParams({ q: args.query });
      if (args.status && args.status !== "all") params.set("status", args.status);
      const res = await request("GET", `/tasks?${params.toString()}`);
      const tasks = res.data.tasks || [];
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: `No tasks matching "${args.query}".` }] };
      }
      const lines = tasks.map((t, i) => {
        const status = t.completed ? "[x]" : "[ ]";
        const time = t.dueTime ? ` at ${t.dueTime}` : "";
        return `${i + 1}. ${status} ${t.title}${time}\n   ID: ${t.id}`;
      });
      return {
        content: [{ type: "text", text: `${tasks.length} result(s) for "${args.query}":\n\n${lines.join("\n")}` }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
