// The controls for each kind of question. Each reads its answers from the
// form context and dispatches changes; none keeps state of its own.

import type { QuestionnaireItem } from "fhir/r4";
import { useState, type ReactNode } from "react";
import { itemControl, maxValue, minValue, sliderStep } from "../fhir/items.ts";
import { t } from "../i18n.ts";
import { useForm } from "./context.ts";
import { fieldId } from "./ids.ts";
import { optionAnswer, optionLabel } from "./options.ts";
import { answerKey, type Answer } from "./state.ts";

interface ControlProps {
  item: QuestionnaireItem;
  label: string;
}

/** Without an explicit item control, option lists longer than this become a drop-down. */
const DROP_DOWN_THRESHOLD = 10;

function RequiredMark({ item }: { item: QuestionnaireItem }) {
  const { lang } = useForm();
  if (!item.required) return null;
  return (
    <span className="required">
      <span aria-hidden="true"> *</span>
      <span className="visually-hidden"> ({t("required", lang)})</span>
    </span>
  );
}

/** A question text as the label of a single control. */
function Label({ item, label }: ControlProps) {
  return (
    <label htmlFor={fieldId(item)} className="question-text text">
      {label}
      <RequiredMark item={item} />
    </label>
  );
}

/** A fieldset with the question text as legend, for groups of radio buttons or checkboxes. */
function Fieldset({ item, label, children }: ControlProps & { children: ReactNode }) {
  return (
    <fieldset id={fieldId(item)} aria-required={item.required || undefined}>
      <legend className="question-text text">
        {label}
        <RequiredMark item={item} />
      </legend>
      {children}
    </fieldset>
  );
}

function useAnswers(item: QuestionnaireItem) {
  const { answers, dispatch, lang } = useForm();
  const current = answers[item.linkId] ?? [];
  const set = (next: Answer[]) => dispatch({ type: "set", linkId: item.linkId, answers: next });
  const toggle = (answer: Answer) => dispatch({ type: "toggle", linkId: item.linkId, answer });
  return { current, set, toggle, lang };
}

export function ChoiceControl({ item, label }: ControlProps) {
  const { current, set, toggle, lang } = useAnswers(item);
  const options = item.answerOption ?? [];
  const selected = new Set(current.map(answerKey));
  const control = itemControl(item);
  const open = item.type === "open-choice";
  const other = current.find((answer) => answer.valueString !== undefined && !options.some((o) => o.valueString === answer.valueString));

  if (options.length === 0) {
    return (
      <p className="unsupported">
        <span className="text">{label}</span> <em>({t("unsupported", lang)}: answerValueSet)</em>
      </p>
    );
  }

  const otherInput = open && (
    <label className="other">
      {t("other", lang)}:{" "}
      <input
        type="text"
        value={other?.valueString ?? ""}
        onChange={(event) => {
          const rest = current.filter((answer) => answer !== other);
          const value = event.target.value;
          set(item.repeats ? [...rest, ...(value ? [{ valueString: value }] : [])] : value ? [{ valueString: value }] : []);
        }}
      />
    </label>
  );

  const dropDown = control === "drop-down" || (control === undefined && !item.repeats && options.length > DROP_DOWN_THRESHOLD);
  if (dropDown) {
    const value = current[0] && !other ? answerKey(current[0]) : "";
    return (
      <div className="field">
        <Label item={item} label={label} />
        <select
          id={fieldId(item)}
          value={value}
          aria-required={item.required || undefined}
          onChange={(event) => {
            const option = options.find((candidate) => answerKey(optionAnswer(candidate)) === event.target.value);
            set(option ? [optionAnswer(option)] : []);
          }}
        >
          <option value="">{t("choose", lang)}</option>
          {options.map((option) => {
            const answer = optionAnswer(option);
            return (
              <option key={answerKey(answer)} value={answerKey(answer)}>
                {optionLabel(option, lang)}
              </option>
            );
          })}
        </select>
        {otherInput}
      </div>
    );
  }

  const type = item.repeats ? "checkbox" : "radio";
  return (
    <Fieldset item={item} label={label}>
      <div className="options">
        {options.map((option) => {
          const answer = optionAnswer(option);
          const key = answerKey(answer);
          return (
            <label key={key} className="option">
              <input
                type={type}
                name={fieldId(item)}
                checked={selected.has(key)}
                onChange={() => (item.repeats ? toggle(answer) : set([answer]))}
              />
              <span className="text">{optionLabel(option, lang)}</span>
            </label>
          );
        })}
      </div>
      {otherInput}
    </Fieldset>
  );
}

export function TextControl({ item, label }: ControlProps) {
  const { current, set } = useAnswers(item);
  const value = current[0]?.valueString ?? current[0]?.valueUri ?? "";
  const key = item.type === "url" ? "valueUri" : "valueString";
  const onChange = (next: string) => set(next === "" ? [] : [{ [key]: next }]);
  return (
    <div className="field">
      <Label item={item} label={label} />
      {item.type === "text" ? (
        <textarea
          id={fieldId(item)}
          rows={3}
          value={value}
          aria-required={item.required || undefined}
          maxLength={item.maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={fieldId(item)}
          type={item.type === "url" ? "url" : "text"}
          value={value}
          aria-required={item.required || undefined}
          maxLength={item.maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

export function NumberControl({ item, label }: ControlProps) {
  const { current, set, lang } = useAnswers(item);
  const integer = item.type === "integer";
  const value = integer ? current[0]?.valueInteger : current[0]?.valueDecimal;
  const [min, max] = [minValue(item), maxValue(item)];
  const toAnswer = (number: number): Answer => (integer ? { valueInteger: number } : { valueDecimal: number });

  if (itemControl(item) === "slider" && min !== undefined && max !== undefined) {
    const step = sliderStep(item) ?? 1;
    const choose = (raw: string) => set([toAnswer(Number(raw))]);
    return (
      <div className="field slider">
        <Label item={item} label={label} />
        <div className="slider-row">
          <span className="slider-end" aria-hidden="true">
            {min}
          </span>
          <input
            id={fieldId(item)}
            type="range"
            min={min}
            max={max}
            step={step}
            className={value === undefined ? "unanswered" : undefined}
            value={value ?? (min + max) / 2}
            aria-valuetext={value === undefined ? t("notAnswered", lang) : String(value)}
            aria-required={item.required || undefined}
            onChange={(event) => choose(event.target.value)}
            // A click on the thumb where it already is sets no new value; still count it as an answer.
            onClick={(event) => value === undefined && choose(event.currentTarget.value)}
          />
          <span className="slider-end" aria-hidden="true">
            {max}
          </span>
          <output htmlFor={fieldId(item)} className="slider-value">
            {value ?? "–"}
          </output>
          {value !== undefined && (
            <button type="button" className="link-button" onClick={() => set([])}>
              {t("clear", lang)}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="field">
      <Label item={item} label={label} />
      <NumberInput
        item={item}
        value={value}
        hasRange={min !== undefined || max !== undefined}
        onChange={(number) => set(number === undefined ? [] : [toAnswer(number)])}
      />
      {(min !== undefined || max !== undefined) && (
        <span id={`${fieldId(item)}-range`} className="hint">
          {min ?? ""}–{max ?? ""}
        </span>
      )}
    </div>
  );
}

/**
 * A number field that keeps what is typed until it is a number: a controlled
 * `<input type=number>` would throw away "1," or "-" half-way through.
 */
function NumberInput(props: {
  item: QuestionnaireItem;
  value: number | undefined;
  hasRange: boolean;
  onChange: (value: number | undefined) => void;
}) {
  const { item, value, hasRange, onChange } = props;
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const parse = (raw: string) => {
    const number = raw.trim() === "" ? undefined : Number(raw.replace(",", "."));
    const valid = number !== undefined && !Number.isNaN(number) && (item.type !== "integer" || Number.isInteger(number));
    return valid ? number : undefined;
  };
  // Show what is typed while it agrees with the answer: the same number, or
  // something that is no number yet and no answer. Otherwise the answer was
  // changed elsewhere (a reset, pre-population), and that wins.
  const parsed = parse(text);
  const agrees = parsed === undefined ? value === undefined : parsed === value;
  const shown = agrees ? text : value === undefined ? "" : String(value);
  return (
    <input
      id={fieldId(item)}
      type="text"
      inputMode={item.type === "integer" ? "numeric" : "decimal"}
      value={shown}
      aria-required={item.required || undefined}
      aria-describedby={hasRange ? `${fieldId(item)}-range` : undefined}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parse(event.target.value));
      }}
    />
  );
}

export function DateControl({ item, label }: ControlProps) {
  const { current, set } = useAnswers(item);
  const [type, key] =
    item.type === "dateTime"
      ? (["datetime-local", "valueDateTime"] as const)
      : item.type === "time"
        ? (["time", "valueTime"] as const)
        : (["date", "valueDate"] as const);
  const value = current[0]?.[key] ?? "";
  return (
    <div className="field">
      <Label item={item} label={label} />
      <input
        id={fieldId(item)}
        type={type}
        value={value}
        aria-required={item.required || undefined}
        onChange={(event) => set(event.target.value === "" ? [] : [{ [key]: event.target.value }])}
      />
    </div>
  );
}

export function BooleanControl({ item, label }: ControlProps) {
  const { current, set, lang } = useAnswers(item);
  const value = current[0]?.valueBoolean;
  return (
    <Fieldset item={item} label={label}>
      <div className="options options-inline">
        {([true, false] as const).map((option) => (
          <label key={String(option)} className="option">
            <input type="radio" name={fieldId(item)} checked={value === option} onChange={() => set([{ valueBoolean: option }])} />
            <span>{t(option ? "yes" : "no", lang)}</span>
          </label>
        ))}
      </div>
    </Fieldset>
  );
}

/** A calculated score. The value arrives in milestone 7; until then it shows the scale. */
export function ScoreOutput({ item, label }: ControlProps) {
  const { lang } = useForm();
  const [min, max] = [minValue(item), maxValue(item)];
  return (
    <div className="field score">
      <span className="question-text text" id={`${fieldId(item)}-label`}>
        {label}
      </span>
      <output id={fieldId(item)} aria-labelledby={`${fieldId(item)}-label`} className="score-value">
        {t("noScore", lang)}
      </output>
      {min !== undefined && max !== undefined && (
        <span className="score-scale">
          {t("scale", lang)} {min}–{max}
        </span>
      )}
    </div>
  );
}
