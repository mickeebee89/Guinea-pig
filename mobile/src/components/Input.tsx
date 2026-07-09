import { useState } from 'react'
import {
  TextInput,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius } from '@/constants/Colors'

interface Props extends TextInputProps {
  label?: string
  error?: string
  secure?: boolean
}

export function Input({ label, error, secure = false, style, ...props }: Props) {
  const [hidden, setHidden] = useState(secure)
  const [focused, setFocused] = useState(false)

  const toggleHidden = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setHidden(h => !h)
  }

  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.row, focused && styles.rowFocused, !!error && styles.rowError]}>
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={Colors.muted}
          secureTextEntry={hidden}
          autoCapitalize={secure ? 'none' : props.autoCapitalize}
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {secure && (
          <TouchableOpacity onPress={toggleHidden} style={styles.eyeBtn}>
            <Text style={styles.eyeIcon}>{hidden ? '👁' : '🙈'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontFamily: Fonts.bodyBold,
    color: Colors.warmDark,
    marginBottom: 6,
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBg,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 16,
  },
  rowFocused: {
    borderColor: Colors.rose,
  },
  rowError: {
    borderColor: Colors.error,
  },
  input: {
    flex: 1,
    height: 52,
    fontSize: 16,
    fontFamily: Fonts.body,
    color: Colors.warmDark,
  },
  eyeBtn: {
    padding: 8,
  },
  eyeIcon: {
    fontSize: 16,
  },
  error: {
    marginTop: 4,
    fontSize: 12,
    color: Colors.error,
  },
})
