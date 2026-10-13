import { describe, expect, it } from "vitest";
import { answerKey, answersReducer } from "./state.ts";

const yes = { valueCoding: { system: "s", code: "yes", display: "Kyllä" } };
const no = { valueCoding: { system: "s", code: "no", display: "Ei" } };

describe("answersReducer", () => {
  it("sets and clears an item's answers", () => {
    const set = answersReducer({}, { type: "set", linkId: "a", answers: [yes] });
    expect(set).toEqual({ a: [yes] });
    expect(answersReducer(set, { type: "set", linkId: "a", answers: [] })).toEqual({});
  });

  it("toggles answers of a repeating item, removing it when the last goes", () => {
    let state = answersReducer({}, { type: "toggle", linkId: "a", answer: yes });
    state = answersReducer(state, { type: "toggle", linkId: "a", answer: no });
    expect(state).toEqual({ a: [yes, no] });
    state = answersReducer(state, { type: "toggle", linkId: "a", answer: { valueCoding: { system: "s", code: "yes" } } });
    expect(state).toEqual({ a: [no] });
    expect(answersReducer(state, { type: "toggle", linkId: "a", answer: no })).toEqual({});
  });

  it("resets everything", () => {
    expect(answersReducer({ a: [yes], b: [{ valueString: "x" }] }, { type: "reset" })).toEqual({});
  });
});

describe("answerKey", () => {
  it("compares codings by system and code only", () => {
    expect(answerKey(yes)).toBe(answerKey({ valueCoding: { system: "s", code: "yes" } }));
    expect(answerKey(yes)).not.toBe(answerKey({ valueCoding: { system: "t", code: "yes" } }));
  });

  it("tells value types apart", () => {
    expect(answerKey({ valueString: "1" })).not.toBe(answerKey({ valueInteger: 1 }));
  });
});
