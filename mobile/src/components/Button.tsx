import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts, Radius, Shadow } from '@/constants/Colors'

type Variant = 'primary' | 'secondary' | 'ghost'

interface Props {
  label: string
  onPress: () => void
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  style?: ViewStyle
  textStyle?: TextStyle
  haptic?: 'light' | 'medium' | 'success' | 'error'
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
  haptic = 'light',
}: Props) {
  const handlePress = async () => {
    if (disabled || loading) return
    if (haptic === 'light')   await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (haptic === 'medium')  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    if (haptic === 'success') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (haptic === 'error')   await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    onPress()
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      disabled={disabled || loading}
      style={[
        styles.base,
        variant === 'primary'   && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost'     && styles.ghost,
        (disabled || loading)   && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? Colors.white : Colors.rose} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'primary'   && styles.labelPrimary,
            variant === 'secondary' && styles.labelSecondary,
            variant === 'ghost'     && styles.labelGhost,
            textStyle,
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primary: {
    backgroundColor: Colors.rose,
    ...Shadow.card,
  },
  secondary: {
    backgroundColor: Colors.softPink,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  label: {
    fontSize: 16,
    fontFamily: Fonts.bodyBold,
    letterSpacing: 0.2,
  },
  labelPrimary: {
    color: Colors.white,
  },
  labelSecondary: {
    color: Colors.rose,
  },
  labelGhost: {
    color: Colors.rose,
  },
})
