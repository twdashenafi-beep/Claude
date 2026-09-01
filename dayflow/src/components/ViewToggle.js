import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { VIEW_MODES } from '../utils/constants';

export default function ViewToggle({ activeView, onChangeView }) {
  const views = [
    { key: VIEW_MODES.MONTH, label: 'Month' },
    { key: VIEW_MODES.WEEK, label: 'Week' },
    { key: VIEW_MODES.DAY, label: 'Day' },
  ];

  return (
    <View style={styles.container}>
      {views.map(v => (
        <TouchableOpacity
          key={v.key}
          style={[styles.tab, activeView === v.key && styles.activeTab]}
          onPress={() => onChangeView(v.key)}
        >
          <Text style={[styles.tabText, activeView === v.key && styles.activeTabText]}>
            {v.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    padding: 2,
    marginHorizontal: 20,
    marginVertical: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
  },
  activeTabText: {
    color: '#000000',
    fontWeight: '600',
  },
});
