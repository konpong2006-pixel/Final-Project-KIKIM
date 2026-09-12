import {create, all, type MathJsInstance} from 'mathjs';

/**
 * Evaluates the arithmetic a student writes inside a note.
 *
 * Scope, deliberately: type an expression and see the result. There is no
 * handwriting recognition here -- reading written maths needs an ML service
 * (Mathpix and friends) and is explicitly out of scope. Graphing is also not
 * here yet: it needs a drawing surface, which arrives with the native modules.
 *
 * `mathjs` is pure JavaScript, so this behaves identically on Android and on
 * the web with no native module and no rebuild.
 *
 * The evaluator is locked down. `mathjs`'s default scope can define variables
 * and call `import`/`createUnit`, which is a code-execution surface we do not
 * want pointed at note text. Those are removed, and every evaluation is given
 * a fresh empty scope so one line in a note cannot leak state into another.
 */

let instance: MathJsInstance | null = null;

function evaluator() {
  if (instance) return instance;
  const math = create(all, {});
  // `import` and `createUnit` can extend the runtime itself, so they are
  // disabled as mathjs's own security guidance recommends.
  //
  // `evaluate`, `parse` and `simplify` are deliberately NOT overridden here:
  // they are the functions this module calls, and stubbing them on the
  // instance disables the evaluator itself. Expression-level access to them is
  // already impossible, because `CALCULABLE` below rejects any line containing
  // a letter other than the `e` of exponent notation -- so "evaluate(...)",
  // "parse(...)" and an assignment like "a = 5" never reach mathjs at all.
  math.import({
    createUnit: function disabled() { throw new Error('createUnit is disabled'); },
    import: function disabled() { throw new Error('import is disabled'); },
  }, {override: true});
  instance = math;
  return math;
}

export type MathLine = {
  /** The original text, unchanged. */
  expression: string;
  /** Present when the line evaluated to something showable. */
  result?: string;
  /** Zero-based index of the line within the note body. */
  line: number;
};

const MAX_LINE_LENGTH = 200;
const MAX_RESULT_LENGTH = 60;

/**
 * A line counts as maths only when it is an explicit calculation: it has to
 * contain an operator and be made only of characters an arithmetic expression
 * uses. Thai prose and ordinary note text must never light up as a sum.
 */
const CALCULABLE = /^[\d\s+\-*/^%().,eE]*$/;
const HAS_OPERATOR = /[+\-*/^%]/;
const HAS_DIGIT = /\d/;

/**
 * Notes are full of things that are punctuation-compatible with arithmetic but
 * are plainly not sums. Without these two guards "2026-09-08" quietly became
 * 2009 and "081-234-5678" became -5831 in the middle of someone's note.
 */
// Three or more digit groups joined by hyphens with no spaces: a date, a phone
// number or an id. A genuine subtraction like "1200-350" has only one hyphen.
const DATE_OR_ID = /^\d+(?:-\d+){2,}$/;
// A digit group with a leading zero ("081", "09") is an identifier, not a
// number. "0.1" is unaffected, because there a zero is followed by a dot.
const LEADING_ZERO_GROUP = /(?:^|[^\d.])0\d/;

export function evaluateExpression(expression: string): string | null {
  const trimmed = expression.trim().replace(/\s*=\s*$/, '');
  if (!trimmed || trimmed.length > MAX_LINE_LENGTH) return null;
  if (!HAS_DIGIT.test(trimmed) || !HAS_OPERATOR.test(trimmed)) return null;
  if (!CALCULABLE.test(trimmed)) return null;
  const compact = trimmed.replace(/\s+/g, '');
  if (DATE_OR_ID.test(compact)) return null;
  if (LEADING_ZERO_GROUP.test(trimmed)) return null;
  try {
    const value = evaluator().evaluate(trimmed) as unknown;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      // Trim binary-floating-point noise: 0.1 + 0.2 should read as 0.3.
      const rounded = Number.parseFloat(value.toPrecision(12));
      return String(rounded);
    }
    if (typeof value === 'boolean') return String(value);
    return null;
  } catch {
    // An unparseable line is just text, not an error the user needs to see.
    return null;
  }
}

/** Finds every calculable line in a note body. */
export function evaluateNoteBody(body: string): MathLine[] {
  return body.split(/\r?\n/).flatMap((expression, line) => {
    const result = evaluateExpression(expression);
    if (result === null) return [];
    if (result.length > MAX_RESULT_LENGTH) return [];
    return [{expression: expression.trim(), line, result}];
  });
}
