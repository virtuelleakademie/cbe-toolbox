import { describe, expect, it } from "vitest";
import {
  corpusUpdateChannel,
  skillUpdateChannel,
  PORTAL_ORIGIN,
  PORTAL_CORPUS_POINTER_URL,
  PORTAL_SKILL_POINTER_URL,
} from "../src/main/delivery-channel";

describe("signed delivery channel configuration", () => {
  it("uses public v2 portal paths with no shared credential", () => {
    const corpus = corpusUpdateChannel({});
    const skill = skillUpdateChannel({});
    expect(corpus.pointerUrl).toBe(PORTAL_CORPUS_POINTER_URL);
    expect(skill.pointerUrl).toBe(PORTAL_SKILL_POINTER_URL);
    expect(corpus.pointerUrl).toBe(`${PORTAL_ORIGIN}/delivery/v2/corpus/stable/latest.json`);
    expect(skill.pointerUrl).toBe(`${PORTAL_ORIGIN}/delivery/v2/skill/stable/latest.json`);
    expect(corpus.requestHeaders).toEqual({});
    expect(skill.requestHeaders).toEqual({});
  });

  it("refuses environment overrides unless unpackaged development opts in", () => {
    const env = {
      CBE_CORPUS_UPDATE_URL: "http://localhost:8788/corpus/latest.json",
      CBE_CORPUS_UPDATE_AUTH: "user:password",
      CBE_SKILL_UPDATE_URL: "http://localhost:8788/skill/latest.json",
      CBE_SKILL_UPDATE_AUTH: "user:password",
    };
    expect(corpusUpdateChannel(env).pointerUrl).toBe(PORTAL_CORPUS_POINTER_URL);
    expect(skillUpdateChannel(env).pointerUrl).toBe(PORTAL_SKILL_POINTER_URL);
    expect(corpusUpdateChannel(env, true)).toEqual({ pointerUrl: env.CBE_CORPUS_UPDATE_URL, requestHeaders: {} });
    expect(skillUpdateChannel(env, true)).toEqual({ pointerUrl: env.CBE_SKILL_UPDATE_URL, requestHeaders: {} });
  });

  it("contains no app-embedded delivery or Basic Auth header", () => {
    for (const channel of [corpusUpdateChannel({}), skillUpdateChannel({})]) {
      expect(Object.keys(channel.requestHeaders)).toEqual([]);
      expect(JSON.stringify(channel)).not.toMatch(/authorization|cookie|delivery-key|password/iu);
    }
  });
});
