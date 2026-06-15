// s12: Package Distribution — mini Pi 的第 12 版（完整版）
//
// 把工具、命令、项目资料整理成一个带清单的包，按清单加载、整体分发。
// 词汇边界：本章新增 PackageManifest / Package / LoadedPackage / loadPackage / pick / manifest / contents。
// 关键：manifest 是入口，决定哪些 contents 可见；清单没列的内容（ignored）不会被加载。

declare const process: {
  exitCode?: number;
};

// ============ s12 新增：能力打包分发 ============

export type PackageManifest = {
  name: string;
  tools: string[];
  commands: string[];
  resources: string[];
};

export type Package = {
  manifest: PackageManifest;
  contents: Record<string, string>;
};

export type LoadedPackage = {
  name: string;
  tools: Record<string, string>;
  commands: Record<string, string>;
  resources: Record<string, string>;
};

function pick(contents: Record<string, string>, names: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = contents[name];
    if (value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}

export function loadPackage(pkg: Package): LoadedPackage {
  return {
    name: pkg.manifest.name,
    tools: pick(pkg.contents, pkg.manifest.tools),
    commands: pick(pkg.contents, pkg.manifest.commands),
    resources: pick(pkg.contents, pkg.manifest.resources),
  };
}

export function installLoadedPackage(
  loaded: LoadedPackage,
  registry: ToolRegistry,
  commands: Map<string, Command>,
  resources: ContextResource[],
): void {
  for (const [name, content] of Object.entries(loaded.tools)) {
    registry.register({
      spec: { name, description: content, input: {} },
      handler: () => `package tool ${name}: ${content}`,
    });
  }

  for (const [name, content] of Object.entries(loaded.commands)) {
    commands.set(name, { name, run: () => content });
  }

  for (const [name, content] of Object.entries(loaded.resources)) {
    resources.push({ kind: "agents", name, content });
  }
}

// —— 以下为 s01–s11 累积的全部能力（mini Pi 完整版）——

export type ProjectTrust = "trusted" | "untrusted";
export type StopReason = "stop" | "toolUse" | "error";
export type UserMessage = { role: "user"; content: string };
export type AssistantMessage = { role: "assistant"; content: string; stopReason: StopReason };
export type ToolResultMessage = { role: "toolResult"; toolCallId: string; content: string };
export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

export type SessionEntry = { id: string; parentId: string | null; message: AgentMessage };
export class SessionTree {
  private entries = new Map<string, SessionEntry>();
  private activeLeafId: string | null = null;
  private counter = 0;
  append(message: AgentMessage): SessionEntry {
    const entry = { id: `e${++this.counter}`, parentId: this.activeLeafId, message };
    this.entries.set(entry.id, entry);
    this.activeLeafId = entry.id;
    return entry;
  }
  moveTo(entryId: string): void {
    if (!this.entries.has(entryId)) throw new Error(`unknown entry: ${entryId}`);
    this.activeLeafId = entryId;
  }
  currentPath(): AgentMessage[] {
    const path: AgentMessage[] = [];
    let cursor = this.activeLeafId;
    while (cursor) {
      const entry = this.entries.get(cursor);
      if (!entry) break;
      path.push(entry.message);
      cursor = entry.parentId;
    }
    return path.reverse();
  }
  allEntries(): SessionEntry[] { return [...this.entries.values()]; }
}
export type AgentState = { session: SessionTree; model: string };

export type ToolSpec = { name: string; description: string; input: Record<string, string> };
export type ToolHandler = (input: Record<string, string>) => string;
export type ToolCall = { id: string; name: string; input: Record<string, string> };
export type Tool = { spec: ToolSpec; handler: ToolHandler };
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  register(tool: Tool): void { this.tools.set(tool.spec.name, tool); }
  getSpecs(): ToolSpec[] { return [...this.tools.values()].map((tool) => tool.spec); }
  count(): number { return this.tools.size; }
  run(call: ToolCall): string {
    const tool = this.tools.get(call.name);
    if (!tool) return `unknown tool: ${call.name}`;
    return tool.handler(call.input);
  }
}

export type ContextResource = { kind: "agents" | "skill" | "prompt"; name: string; content: string };
export class ResourceLoader {
  constructor(private resources: ContextResource[]) {}
  load(trust: ProjectTrust = "trusted"): ContextResource[] {
    if (trust === "untrusted") return [];
    return this.resources.map((r) => ({ ...r }));
  }
}
export function buildSystemPrompt(resources: ContextResource[]): string {
  return resources.map((r) => `[${r.kind}:${r.name}]\n${r.content}`).join("\n\n");
}

export type ProviderMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "toolResult"; toolCallId: string; content: string };
export type ProviderInput = { systemPrompt: string; messages: ProviderMessage[]; tools: ToolSpec[] };
export type ProviderEvent =
  | { type: "message_start" }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "message_end"; stopReason: StopReason };
export interface Provider { stream(input: ProviderInput): AsyncGenerator<ProviderEvent>; }

export type Output = { log(line: string): void };
export function createConsoleOutput(): Output { return { log: (line) => console.log(line) }; }

export type BeforeToolCallResult = { type: "allow" } | { type: "block"; reason: string };
export type ToolHooks = {
  beforeToolCall?: (call: ToolCall) => BeforeToolCallResult;
  afterToolCall?: (call: ToolCall, result: string) => string;
};
export function executeToolCall(registry: ToolRegistry, hooks: ToolHooks, call: ToolCall): ToolResultMessage {
  const before = hooks.beforeToolCall?.(call) ?? { type: "allow" };
  if (before.type === "block") return { role: "toolResult", toolCallId: call.id, content: `blocked: ${before.reason}` };
  let result: string;
  try { result = registry.run(call); }
  catch (error) { result = `error: ${error instanceof Error ? error.message : String(error)}`; }
  const finalResult = hooks.afterToolCall?.(call, result) ?? result;
  return { role: "toolResult", toolCallId: call.id, content: finalResult };
}

export type TurnSnapshot = { systemPrompt: string; messages: ProviderMessage[]; tools: ToolSpec[] };
function toProviderMessages(messages: AgentMessage[]): ProviderMessage[] {
  return messages.map((message) => {
    if (message.role === "toolResult") {
      return { role: "toolResult", toolCallId: message.toolCallId, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}
export function createTurnSnapshot(
  state: AgentState, registry: ToolRegistry, loader: ResourceLoader, trust: ProjectTrust = "trusted",
): TurnSnapshot {
  return {
    systemPrompt: buildSystemPrompt(loader.load(trust)),
    messages: toProviderMessages(state.session.currentPath()),
    tools: registry.getSpecs(),
  };
}
export function buildProviderInputFromSnapshot(snapshot: TurnSnapshot, state: AgentState): ProviderInput {
  return {
    systemPrompt: snapshot.systemPrompt,
    messages: toProviderMessages(state.session.currentPath()),
    tools: snapshot.tools,
  };
}

export function createInitialState(model = "demo-small"): AgentState { return { session: new SessionTree(), model }; }
export function createUserMessage(content: string): UserMessage { return { role: "user", content }; }

const MAX_TURNS = 8;
export async function runEventedToolLoop(
  state: AgentState, provider: Provider, registry: ToolRegistry,
  hooks: ToolHooks, snapshot: TurnSnapshot, output: Output,
): Promise<AssistantMessage> {
  let turns = 0;
  while (true) {
    turns += 1;
    if (turns > MAX_TURNS) {
      const stopped: AssistantMessage = { role: "assistant", content: "(达到最大轮次，停止)", stopReason: "stop" };
      state.session.append(stopped);
      return stopped;
    }
    const providerInput = buildProviderInputFromSnapshot(snapshot, state);
    let content = "";
    let stopReason: StopReason = "stop";
    let sawToolCall = false;
    for await (const event of provider.stream(providerInput)) {
      if (event.type === "message_start") output.log("message_start");
      else if (event.type === "text_delta") { output.log(`text_delta: ${event.text}`); content += event.text; }
      else if (event.type === "tool_call") {
        sawToolCall = true;
        output.log(`tool_call: ${event.call.name}`);
        const resultMessage = executeToolCall(registry, hooks, event.call);
        state.session.append(resultMessage);
        output.log(`tool_result: ${resultMessage.content}`);
      } else if (event.type === "message_end") { stopReason = event.stopReason; output.log(`message_end: ${stopReason}`); }
    }
    if (!sawToolCall || stopReason !== "toolUse") {
      const assistant: AssistantMessage = { role: "assistant", content, stopReason };
      state.session.append(assistant);
      return assistant;
    }
  }
}

export type RuntimeEvent = { type: "message"; content: string } | { type: "done" };
type EventHandler<T extends RuntimeEvent["type"]> = (event: Extract<RuntimeEvent, { type: T }>) => void;
export type Command = { name: string; run: () => string };
export type ExtensionAPI = {
  on<T extends RuntimeEvent["type"]>(type: T, handler: EventHandler<T>): void;
  registerTool(tool: Tool): void;
  registerCommand(command: Command): void;
};
export type Extension = (api: ExtensionAPI) => void;
export class ExtensionRuntime {
  private commands = new Map<string, Command>();
  private handlers: { type: RuntimeEvent["type"]; handler: (event: RuntimeEvent) => void }[] = [];
  constructor(private registry: ToolRegistry) {}
  createApi(): ExtensionAPI {
    return {
      on: (type, handler) => { this.handlers.push({ type, handler: handler as (event: RuntimeEvent) => void }); },
      registerTool: (tool) => { this.registry.register(tool); },
      registerCommand: (command) => { this.commands.set(command.name, command); },
    };
  }
  use(extension: Extension): void { extension(this.createApi()); }
  emit(event: RuntimeEvent): void {
    for (const { type, handler } of this.handlers) if (type === event.type) handler(event);
  }
  runCommand(name: string): string {
    const command = this.commands.get(name);
    if (!command) return `unknown command: ${name}`;
    return command.run();
  }
}

export function createDemoRuntimeEvents(input: string): RuntimeEvent[] {
  return [{ type: "message", content: `收到：${input}` }, { type: "done" }];
}
export type RuntimeMode = { render(events: RuntimeEvent[]): void };
export class PrintMode implements RuntimeMode {
  render(events: RuntimeEvent[]): void {
    for (const event of events) if (event.type === "message") console.log(event.content);
  }
}
export class JsonMode implements RuntimeMode {
  render(events: RuntimeEvent[]): void {
    for (const event of events) console.log(JSON.stringify(event));
  }
}

// ============ 演示脚手架 ============

function createPackage(): Package {
  return {
    manifest: {
      name: "demo-package",
      tools: ["note"],
      commands: ["status"],
      resources: ["AGENTS.md"],
    },
    contents: {
      note: "tool: 保存一条笔记",
      status: "command: 打印包状态",
      "AGENTS.md": "Use package resources when building context.",
      ignored: "这份内容不在清单里，不会被加载",
    },
  };
}

function main(): void {
  const output = createConsoleOutput();
  const pkg = createPackage();
  const loaded = loadPackage(pkg);
  const registry = new ToolRegistry();
  const commands = new Map<string, Command>();
  const resources: ContextResource[] = [];

  installLoadedPackage(loaded, registry, commands, resources);

  output.log("s12: Package Distribution");
  output.log("");

  output.log("[manifest]");
  output.log(`name: ${pkg.manifest.name}`);
  output.log(`tools: ${pkg.manifest.tools.join(", ")}`);
  output.log(`commands: ${pkg.manifest.commands.join(", ")}`);
  output.log(`resources: ${pkg.manifest.resources.join(", ")}`);
  output.log("");

  output.log("[loaded]");
  output.log(`tools: ${Object.keys(loaded.tools).length}`);
  output.log(`commands: ${Object.keys(loaded.commands).length}`);
  output.log(`resources: ${Object.keys(loaded.resources).length}`);
  output.log("");

  output.log("[installed]");
  output.log(`registry tools: ${registry.count()}`);
  output.log(`commands: ${commands.size}`);
  output.log(`resources: ${resources.length}`);
  output.log(`note -> ${registry.run({ id: "pkg-tool-1", name: "note", input: {} })}`);
  output.log(`/status -> ${commands.get("status")?.run() ?? "missing"}`);
  output.log("");
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
