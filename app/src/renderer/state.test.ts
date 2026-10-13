import { describe, expect, it } from "vitest";
import { answerKey, emptyForm, formReducer } from "./state.ts";

const yes = { valueCoding: { system: "s", code: "yes", display: "Kyllä" } };
const no = { valueCoding: { system: "s", code: "no", display: "Ei" } };

describe("formReducer", () => {
  it("sets and clears an item's answers", () => {
    const set = formReducer(emptyForm, { type: "set", linkId: "a", answers: [yes] });
    expect(set.answers).toEqual({ a: [yes] });
    expect(formReducer(set, { type: "set", linkId: "a", answers: [] }).answers).toEqual({});
  });

  it("toggles answers of a repeating item, removing it when the last goes", () => {
    let state = formReducer(emptyForm, { type: "toggle", linkId: "a", answer: yes });
    state = formReducer(state, { type: "toggle", linkId: "a", answer: no });
    expect(state.answers).toEqual({ a: [yes, no] });
    state = formReducer(state, { type: "toggle", linkId: "a", answer: { valueCoding: { system: "s", code: "yes" } } });
    expect(state.answers).toEqual({ a: [no] });
    expect(formReducer(state, { type: "toggle", linkId: "a", answer: no }).answers).toEqual({});
  });

  it("flags invalid text until a valid answer replaces it", () => {
    let state = formReducer(emptyForm, { type: "invalid", linkId: "n", invalid: true });
    expect(state.invalid).toEqual({ n: true });
    state = formReducer(state, { type: "set", linkId: "n", answers: [] });
    expect(state.invalid).toEqual({ n: true });
    state = formReducer(state, { type: "set", linkId: "n", answers: [{ valueInteger: 2 }] });
    expect(state.invalid).toEqual({});
    state = formReducer(state, { type: "invalid", linkId: "m", invalid: true });
    expect(formReducer(state, { type: "invalid", linkId: "m", invalid: false }).invalid).toEqual({});
  });

  it("resets everything", () => {
    const state = formReducer(
      formReducer(emptyForm, { type: "set", linkId: "a", answers: [yes] }),
      { type: "invalid", linkId: "n", invalid: true },
    );
    expect(formReducer(state, { type: "reset" })).toEqual(emptyForm);
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

describe("provenance", () => {
  const source = { reference: "Observation/h", resourceType: "Observation", resource: { resourceType: "Observation" } } as never;
  const filled = formReducer(emptyForm, {
    type: "populated",
    state: { ...emptyForm, answers: { h: [{ valueDecimal: 165 }] } },
    provenance: { h: { method: "observation", sources: [source] } },
  });

  it("is recorded with populated answers", () => {
    expect(filled.answers).toEqual({ h: [{ valueDecimal: 165 }] });
    expect(filled.provenance.h?.sources).toEqual([source]);
  });

  it("goes when the person changes the answer", () => {
    expect(formReducer(filled, { type: "set", linkId: "h", answers: [{ valueDecimal: 170 }] }).provenance).toEqual({});
  });

  it("goes back with restore and reset", () => {
    expect(formReducer(filled, { type: "restore", state: emptyForm })).toEqual(emptyForm);
    expect(formReducer(filled, { type: "reset" })).toEqual(emptyForm);
  });
});
