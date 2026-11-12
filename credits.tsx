import React from "react";
import {
    ScrollView, View, Text, Image, StyleSheet, useWindowDimensions,
} from "react-native"

const MEMBER = [
    { name: "Janna Mikylla T. Convocar", photo: require("../assets/members/janna.jpg")}
    { name: "Rhace Kleen J. Epan", photo: require("../assets/members/rhace.jpg")},
    { name: "Seifer John R. Neill", photo: require("../assets/members/seifer.jpg")},
    { name: "Pamela Sophia C. Padua", photo: require("../assets/members/pamela.jpg")},
];

export default function CreditssCREEN() {
    const { width } = useWindowDimensions();
    const GAP = 14;
    const PAD = 20;
    const cardSize = (witdh - PAD * 2 - GAP ) / 2;

    return(
        <ScrollView contentContainerStyle={{ padding: PAD, backgroundColor: "#eee"}}>
             <Text style={styles.title}>CREDITS</Text>

      <View style={styles.grid}>
        {MEMBERS.map((m) => (
          <View key={m.name} style={{ width: cardSize, marginBottom: 20 }}>
            <Image
              source={m.photo}
              style={{ width: cardSize, height: cardSize, backgroundColor: "#eee" }}
              resizeMode="cover"
            />
            <Text style={styles.name}>{m.name}</Text>
          </View>
        ))}
      </View>

      <View style={styles.info}>
        <Text style={styles.label}>School</Text>
        <Text style={styles.value}>Antipolo City National Science and Technology High School</Text>

        <Text style={styles.label}>Grade Level & Section</Text>
        <Text style={styles.value}>12 Darwin</Text>

        <Text style={styles.label}>Subject</Text>
        <Text style={styles.value}>Capstone</Text>

        <Text style={styles.label}>Subject Adviser</Text>
        <Text style={styles.value}>Mrs. Corazon A. Adrales</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 34, fontWeight: "900", color: "#222",
    textAlign: "center", marginVertical: 20,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  name: { fontSize: 16, fontWeight: "800", color: "#222", textAlign: "center", marginTop: 10 },
  sub: { fontSize: 12, fontStyle: "italic", color: "#444", textAlign: "center", marginTop: 3 },
  info: { alignItems: "center", marginTop: 10, paddingBottom: 30 },
  label: { fontSize: 18, fontWeight: "800", color: "#222", marginTop: 16 },
  value: { fontSize: 14, fontStyle: "italic", color: "#444", textAlign: "center", marginTop: 3 },
});