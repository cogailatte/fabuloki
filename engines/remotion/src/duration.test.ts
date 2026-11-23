

import assert from "node:assert/strict";
import { test } from "node:test";
import { footageDurationFrames, rawSceneDurationFrames, sceneSpeedOf } from "./duration";
import { resolveSceneDurationInFrames, sceneSchema } from "./manifest";

test("speed 1 = công thức cũ (làm tròn từng đầu)", () => {

  assert.equal(footageDurationFrames(1.02, 3.98, 30), 88);
  assert.equal(footageDurationFrames(1.02, 3.98, 30, 1), 88);
  assert.equal(footageDurationFrames(0, 10, 30), 300);
});

test("speed chia SAU khi làm tròn hai đầu", () => {
  assert.equal(footageDurationFrames(0, 10, 30, 2), 150);
  assert.equal(footageDurationFrames(0, 10, 30, 0.5), 600);
  assert.equal(footageDurationFrames(0, 1, 30, 4), 8);
  assert.equal(footageDurationFrames(1.02, 3.98, 30, 3), 29);
});

test("tối thiểu 1 frame, speed hỏng rơi về 1", () => {
  assert.equal(footageDurationFrames(1, 1, 30, 2), 1);
  assert.equal(footageDurationFrames(0, 2, 30, 0), 60);
  assert.equal(footageDurationFrames(0, 2, 30, Number.NaN), 60);
});

test("sceneSpeedOf: chỉ nhận số trong 0.25..4", () => {
  assert.equal(sceneSpeedOf({}), 1);
  assert.equal(sceneSpeedOf({ speed: 2 }), 2);
  assert.equal(sceneSpeedOf({ speed: 0.25 }), 0.25);
  assert.equal(sceneSpeedOf({ speed: 0.1 }), 1);
  assert.equal(sceneSpeedOf({ speed: 5 }), 1);
  assert.equal(sceneSpeedOf({ speed: "2" }), 1);
});

test("rawSceneDurationFrames + resolveSceneDurationInFrames cùng kết quả", () => {
  const raw = { id: "a", srcVideo: "assets/a.mp4", from: 2, to: 8, speed: 1.5 };
  assert.equal(rawSceneDurationFrames(raw, 30), 120);
  const scene = sceneSchema.parse(raw);
  assert.equal(resolveSceneDurationInFrames(scene, 30), 120);

  assert.equal(rawSceneDurationFrames({ ...raw, durationInFrames: 45 }, 30), 45);
  assert.equal(resolveSceneDurationInFrames(sceneSchema.parse({ ...raw, durationInFrames: 45 }), 30), 45);

  assert.equal(rawSceneDurationFrames({ srcImage: "assets/x.png", speed: 2 }, 30), null);
});
