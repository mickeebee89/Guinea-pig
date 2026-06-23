import React from 'react'
import { Text as RNText } from 'react-native'
import type { TextProps } from 'react-native'

// Injects Quicksand_400Regular as the base font for every Text in the app.
// Any explicit fontFamily in the component's own style (e.g. DancingScript on
// headings) sits later in the array and overrides this default.
export const Text = React.forwardRef<any, TextProps>(({ style, ...rest }, ref) => (
  <RNText ref={ref} {...rest} style={[{ fontFamily: 'Quicksand_400Regular' }, style]} />
))

Text.displayName = 'Text'
