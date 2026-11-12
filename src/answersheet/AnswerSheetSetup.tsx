import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
} from "react-native";
import {
  MAX_ITEMS, CHOICE_LABELS, ChoiceType, createAnswerSheet, AnswerSheetConfig,
} from "./answerSheetConfig";

const TYPES = Object.keys(CHOICE_LABELS) as ChoiceType[];

export default function AnswerSheetSetup({
  initial = { items: 50, choiceType: "AD" },
  onSave,
}: {
  initial?: AnswerSheetConfig;
  onSave: (config: AnswerSheetConfig) => void;
}) {
  const [itemsText, setItemsText] = useState(String(initial.items));
  const [choiceType, setChoiceType] = useState<ChoiceType>(initial.choiceType);

  const items = Math.min(MAX_ITEMS, Math.max(1, parseInt(itemsText, 10) || 1));
  const sheet = createAnswerSheet(items, choiceType);

  const onChangeItems = (t: string) => {
    const digits = t.replace(/[^0-9]/g, "");
    if (digits === "") return setItemsText("");
    setItemsText(String(Math.min(MAX_ITEMS, parseInt(digits, 10))));
  };

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.label}>Number of items (1–{MAX_ITEMS})</Text>
      <TextInput
        style={s.input}
        keyboardType="number-pad"
        value={itemsText}
        onChangeText={onChangeItems}
        onBlur={() => setItemsText(String(items))}
        maxLength={3}
      />

      <Text style={s.label}>Choices</Text>
      <View style={s.chips}>
        {TYPES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[s.chip, choiceType === t && s.chipOn]}
            onPress={() => setChoiceType(t)}
          >
            <Text style={[s.chipText, choiceType === t && s.chipTextOn]}>
              {CHOICE_LABELS[t]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.label}>Preview</Text>
      <View style={s.preview}>
        {sheet.rows.slice(0, 5).map((r) => (
          <View key={r.item} style={s.row}>
            <Text style={s.num}>{r.item}.</Text>
            {sheet.options.map((o) => (
              <View key={o} style={s.bubble}>
                <Text style={s.bubbleText}>{o}</Text>
              </View>
            ))}
          </View>
        ))}
        {items > 5 && <Text style={s.more}>… up to item {items}</Text>}
      </View>

      <TouchableOpacity style={s.save} onPress={() => onSave({ items, choiceType })}>
        <Text style={s.saveText}>Save answer sheet</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 16 },
  label: { fontWeight: "700", marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, fontSize: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: "#1d4ed8" },
  chipOn: { backgroundColor: "#1d4ed8" },
  chipText: { color: "#1d4ed8", fontWeight: "600" },
  chipTextOn: { color: "#fff" },
  preview: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 10 },
  row: { flexDirection: "row", alignItems: "center", marginVertical: 3 },
  num: { width: 32, fontWeight: "600" },
  bubble: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: "#333", alignItems: "center", justifyContent: "center", marginRight: 8 },
  bubbleText: { fontSize: 11 },
  more: { marginTop: 6, color: "#666" },
  save: { backgroundColor: "#1d4ed8", padding: 14, borderRadius: 10, marginTop: 24, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
