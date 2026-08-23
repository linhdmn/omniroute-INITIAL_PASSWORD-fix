/**
 * GLM-family text-only gateways (Z.AI/Zhipu — opencode-go, opencode-zen, glm-*)
 * reject any request carrying image content with `400 [1210] Invalid API
 * parameter / 图片输入格式/解析错误`. Claude Code agent loops legitimately
 * produce image blocks: the Read tool returns base64 screenshots and browser
 * tools attach captures as tool_result images.
 *
 * When credentials carry `_stripImages === true` (set by translateRequest for
 * GLM-family providers), claudeToOpenAIRequest replaces every image part with
 * a short text marker so the agent keeps running on text-only upstreams.
 * Vision-capable providers are unaffected (no flag → images forwarded as
 * image_url exactly as before).
 */
import test from "node:test";
import assert from "node:assert/strict";

const { claudeToOpenAIRequest } = await import(
  "../../open-sse/translator/request/claude-to-openai.ts"
);

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const BODY_WITH_IMAGES = {
  system: "You are helpful.",
  max_tokens: 64,
  messages: [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } },
        { type: "text", text: "what is in this screenshot?" },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/s.png" } }],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } },
          ],
        },
      ],
    },
  ],
};

function countImageParts(messages: Array<Record<string, unknown>>): number {
  let n = 0;
  for (const m of messages) {
    const c = m.content;
    if (!Array.isArray(c)) continue;
    for (const p of c) {
      if (!p || typeof p !== "object") continue;
      if (p.type === "image_url") n += 1;
      if (JSON.stringify(p).includes("data:image")) n += 1;
    }
  }
  return n;
}

test("RED: _stripImages removes user-message images and leaves an explanatory marker", () => {
  const result = claudeToOpenAIRequest("ox-alpha-free", BODY_WITH_IMAGES, false, {
    _stripImages: true,
  });
  assert.equal(countImageParts(result.messages), 0, "no image parts may survive");
  const userMsg = result.messages.find((m) => m.role === "user");
  assert.ok(userMsg, "user turn must exist");
  const first = JSON.stringify(userMsg);
  assert.ok(first.includes("image"), "marker should mention the omitted image");
  assert.ok(first.includes("what is in this screenshot?"), "text content preserved");
});

test("RED: _stripImages removes tool_result images lifted into following turns", () => {
  const result = claudeToOpenAIRequest("muse-spark-1.2-contributor", BODY_WITH_IMAGES, false, {
    _ensureUserTurn: true,
    _stripImages: true,
  });
  assert.equal(countImageParts(result.messages), 0);
});

test("RED: without the flag images still become image_url parts (unchanged behavior)", () => {
  const result = claudeToOpenAIRequest("gpt-4o", BODY_WITH_IMAGES, false, null);
  assert.ok(countImageParts(result.messages) >= 2, "both images must be forwarded");
});
