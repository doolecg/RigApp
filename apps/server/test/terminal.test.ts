import { expect, it } from "vitest";
import { mapInput } from "../src/terminal.ts";

it("turns typed text into literal text and special keys into tmux key names", () => {
  expect(mapInput("ls -la\r")).toEqual([
    { type: "text", text: "ls -la" },
    { type: "keys", keys: ["Enter"] },
  ]);
  expect(mapInput("\x1b[A\x1b[B\x7f\x03")).toEqual([
    { type: "keys", keys: ["Up"] },
    { type: "keys", keys: ["Down"] },
    { type: "keys", keys: ["BSpace"] },
    { type: "keys", keys: ["C-c"] },
  ]);
  expect(mapInput("\x1b")).toEqual([{ type: "keys", keys: ["Escape"] }]);
});
