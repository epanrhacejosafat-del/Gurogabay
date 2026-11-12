import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from "react-native";
import { HeaderField, MAX_FIELDS, newField } from "./headerConfig";

export default function HeaderEditor({
  initial,
  onSave,
}: {
  initial: HeaderField[];
  onSave: (fields: HeaderField[]) => void;
}) {
  const [fields, setFields] = useState<HeaderField[]>(initial);

  const update = (id: string, patch: Partial<HeaderField>) =>
    setFields((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => setFields((f) => f.filter((x) => x.id !== id));
  const move = (i: number, dir: -1 | 1) =>
    setFields((f) => {
      const j = i + dir;
      if (j < 0 || j >= f.length) return f;
      const c = [...f];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {fields.map((f, i) => (
        <View key={f.id} style={s.card}>
          <TextInput
            style={s.input}
            value={f.label}
            placeholder="Label"
            onChangeText={(t) => update(f.id, { label: t })}
          />
          {f.kind === "text" && (
            <TextInput
              style={s.input}
              value={f.value}
              placeholder="Pre-printed text (optional)"
              onChangeText={(t) => update(f.id, { value: t })}
            />
          )}
          <View style={s.row}>
            <Btn
              text={f.span === 2 ? "Full width" : "Half width"}
              onPress={() => update(f.id, { span: f.span === 2 ? 1 : 2 })}
            />
            <Btn
              text={f.kind === "score" ? "Score box ✓" : "Make score box"}
              onPress={() => update(f.id, { kind: f.kind === "score" ? "text" : "score" })}
            />
            <Btn text="↑" onPress={() => move(i, -1)} />
            <Btn text="↓" onPress={() => move(i, 1)} />
            <Btn text="Delete" danger onPress={() => remove(f.id)} />
          </View>
        </View>
      ))}
      {fields.length < MAX_FIELDS && (
        <Btn text="+ Add field" onPress={() => setFields((f) => [...f, newField()])} />
      )}
      <TouchableOpacity style={s.save} onPress={() => onSave(fields)}>
        <Text style={s.saveText}>Save header</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const Btn = ({ text, onPress, danger }: any) => (
  <TouchableOpacity
    onPress={onPress}
    style={[s.btn, danger && { borderColor: "#dc2626" }]}
  >
    <Text style={{ color: danger ? "#dc2626" : "#1d4ed8", fontWeight: "600" }}>{text}</Text>
  </TouchableOpacity>
);

const s = StyleSheet.create({
  card: { borderWidth: 1, borderColor: "#ddd", borderRadius: 10, padding: 10, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 8, marginBottom: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  btn: { borderWidth: 1, borderColor: "#1d4ed8", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  save: { backgroundColor: "#1d4ed8", padding: 14, borderRadius: 10, marginTop: 16, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
