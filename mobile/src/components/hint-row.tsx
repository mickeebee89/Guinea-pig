import type { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Colors, Fonts, Radius, Spacing } from '@/constants/Colors';

type HintRowProps = {
  title?: string;
  hint?: ReactNode;
};

export function HintRow({ title = 'Try editing', hint = 'app/index.tsx' }: HintRowProps) {
  return (
    <View style={styles.stepRow}>
      <ThemedText type="small" style={styles.title}>{title}</ThemedText>
      <ThemedView style={styles.codeSnippet}>
        <ThemedText style={styles.hintText}>{hint}</ThemedText>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: Fonts.body,
    color: Colors.warmDark,
  },
  codeSnippet: {
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  hintText: {
    fontFamily: Fonts.bodyBold,
    color: Colors.muted,
  },
});
