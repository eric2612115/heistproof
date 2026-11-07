import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { toChat, fromChat, startBridge } from "../src/bridge.ts";

test("translates an Anthropic tool round trip into Chat Completions messages", () => {
  const chat = toChat(
    {
      model: "m",
      max_tokens: 64000,
      system: [{ type: "text", text: "You are careful." }],
      messages: [
        { role: "user", content: "Read price.js" },
        { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "price.js" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "export const priceCents = 4900;" }] }, { type: "text", text: "Go on." }] },
      ],
      tools: [{ name: "Read", description: "Read a file", input_schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { file_path: { type: "string" } } } }],
      tool_choice: { type: "any" },
      stream: true,
    },
    16000,
    "https://api.openai.com/v1",
  ) as any;
  assert.equal(chat.messages[0].role, "system");
  assert.equal(chat.messages[2].tool_calls[0].function.name, "Read");
  assert.equal(chat.messages[2].tool_calls[0].function.arguments, JSON.stringify({ file_path: "price.js" }));
  assert.deepEqual(chat.messages[3], { role: "tool", tool_call_id: "toolu_1", content: "export const priceCents = 4900;" });
  assert.equal(chat.messages[4].content, "Go on.");
  assert.equal(chat.max_completion_tokens, 16000, "OpenAI gets max_completion_tokens, clamped");
  assert.equal(chat.tool_choice, "required");
  assert.equal(chat.tools[0].function.parameters.$schema, undefined, "$schema is stripped");
});

test("translates a Chat Completions tool call back into an Anthropic message", () => {
  const msg = fromChat({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_9", function: { name: "Bash", arguments: '{"command":"npm test"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }, "m") as any;
  assert.equal(msg.stop_reason, "tool_use");
  assert.deepEqual(msg.content[0], { type: "tool_use", id: "call_9", name: "Bash", input: { command: "npm test" } });
  assert.deepEqual(msg.usage, { input_tokens: 10, output_tokens: 5 });
});

test("streams text and tool calls as Anthropic server-sent events", async () => {
  const chunks = [
    { choices: [{ delta: { content: "Running " } }] },
    { choices: [{ delta: { content: "tests." } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: '{"comm' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"npm test"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 4 } },
  ];
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const bridge = await startBridge({ baseUrl: `http://127.0.0.1:${(upstream.address() as any).port}`, apiKey: "k" });
  try {
    const refused = await fetch(`${bridge.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(refused.status, 401, "no token, no model");
    const res = await fetch(`${bridge.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bridge.token}` }, body: JSON.stringify({ model: "m", max_tokens: 100, stream: true, messages: [{ role: "user", content: "hi" }] }) });
    const events = (await res.text()).split("\n\n").filter(Boolean).map((block) => JSON.parse(block.split("\ndata: ")[1]));
    const types = events.map((e) => e.type);
    assert.deepEqual(types, ["message_start", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
    assert.equal(events[5].content_block.name, "Bash");
    assert.equal(events[6].delta.partial_json + events[7].delta.partial_json, '{"command":"npm test"}');
    assert.equal(events[9].delta.stop_reason, "tool_use");
  } finally {
    await bridge.close();
    upstream.close();
  }
});
