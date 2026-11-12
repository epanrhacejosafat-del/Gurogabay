export type FieldKind = "text" | "score";

export interface HeaderField {
  id: string;
  label: string;   // e.g. "Name", "Section", "Teacher"
  value: string;   // pre-printed text; leave empty for a blank line
  kind: FieldKind; // "score" prints a box like "Score: [  ] / 50"
  span: 1 | 2;     // 1 = half width, 2 = full width
}

export const MAX_FIELDS = 8;

export const DEFAULT_HEADER: HeaderField[] = [
  { id: "name",  label: "Name",  value: "", kind: "text",  span: 2 },
  { id: "class", label: "Class", value: "", kind: "text",  span: 1 },
  { id: "date",  label: "Date",  value: "", kind: "text",  span: 1 },
  { id: "quiz",  label: "Quiz",  value: "", kind: "text",  span: 1 },
  { id: "score", label: "Score", value: "", kind: "score", span: 1 },
];

export const newField = (): HeaderField => ({
  id: `f${Date.now()}`,
  label: "New field",
  value: "",
  kind: "text",
  span: 1,
});
