import React from 'react';
import { View, Text, Image, useWindowDimensions } from 'react-native';

const MEMBERS = [
  { name: 'Janna Mikylla T. Convocar', photo: require('./assets/members/janna.jpeg') },
  { name: 'Rhace Kleen J. Epan', photo: require('./assets/members/rhace.jpg') },
  { name: 'Seifer John R. Neill', photo: require('./assets/members/seifer.jpg') },
  { name: 'Pamela Sophia C. Padua', photo: require('./assets/members/pamela.jpg') },
];
const INFO = [
  ['School', 'Antipolo City National Science and Technology High School'],
  ['Grade Level & Section', '12 Darwin'],
  ['Subject', 'Capstone'],
  ['Subject Adviser', 'Mrs. Corazon A. Adrales'],
];

export default function CreditsPanel({ c }) {
  const { width } = useWindowDimensions();
  const size = (width - 40 - 14) / 2;
  return (
    <View>
      <Text style={{ fontSize: 30, fontWeight: '900', color: c.ink, textAlign: 'center', marginVertical: 12 }}></Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {MEMBERS.map((m) => (
          <View key={m.name} style={{ width: size, marginBottom: 20 }}>
            <Image source={m.photo} style={{ width: size, height: size, backgroundColor: c.card }} resizeMode="cover" />
            <Text style={{ fontSize: 16, fontWeight: '800', color: c.ink, textAlign: 'center', marginTop: 10 }}>{m.name}</Text>
            <Text style={{ fontSize: 12, fontStyle: 'italic', color: c.mute, textAlign: 'center', marginTop: 3 }}></Text>
          </View>
        ))}
      </View>
      <View style={{ alignItems: 'center', paddingBottom: 30 }}>
        {INFO.map(([k, v]) => (
          <View key={k} style={{ alignItems: 'center', marginTop: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: c.ink }}>{k}</Text>
            <Text style={{ fontSize: 14, fontStyle: 'italic', color: c.mute, textAlign: 'center', marginTop: 3 }}>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}