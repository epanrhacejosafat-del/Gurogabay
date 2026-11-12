export const MAX_ITEMS = 100;

export type ChoiceType = "AB" | "AC" | "AD" | "AE" | "TF";

export const CHOICE_OPTIONS: Record<ChoiceType, string[]> = {
  AB: ["A", "B"],
  AC: ["A", "B", "C"],
  AD: ["A", "B", "C", "D"],
  AE: ["A", "B", "C", "D", "E"],
  TF: ["T", "F"],
};

export const CHOICE_LABELS: Record<ChoiceType, string> = {
  AB: "A – B",
  AC: "A – C",
  AD: "A – D",
  AE: "A – E",
  TF: "True / False",
};

export interface AnswerSheetConfig {
  items: number; // 1–100
  choiceType: ChoiceType;
}

export interface AnswerSheetLayout extends AnswerSheetConfig {
  options: string[];
  columns: number;
  rowsPerColumn: number;
  rows: { item: number; column: number; row: number }[];
}

export function createAnswerSheet(
  items: number,
  choiceType: ChoiceType = "AD"
): AnswerSheetLayout {
  if (!Number.isInteger(items) || items < 1 || items > MAX_ITEMS) {
    throw new Error(`Items must be a whole number from 1 to ${MAX_ITEMS}.`);
  }
  if (!(choiceType in CHOICE_OPTIONS)) {
    throw new Error("Invalid choice type.");
  }

  const rowsPerColumn = 25;
  const columns = Math.ceil(items / rowsPerColumn);

  const rows = Array.from({ length: items }, (_, i) => ({
    item: i + 1,
    column: Math.floor(i / rowsPerColumn),
    row: i % rowsPerColumn,
  }));

  return {
    items,
    choiceType,
    options: CHOICE_OPTIONS[choiceType],
    columns,
    rowsPerColumn,
    rows,
  };
}

export function isValidMark(sheet: AnswerSheetLayout, mark: string): boolean {
  return sheet.options.includes(mark.toUpperCase());
}

export function cleanAnswerKey(
  sheet: AnswerSheetLayout,
  key: Record<number, string>
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [k, v] of Object.entries(key)) {
    const n = Number(k);
    if (n >= 1 && n <= sheet.items && isValidMark(sheet, v)) {
      out[n] = v.toUpperCase();
    }
  }
  return out;
}
