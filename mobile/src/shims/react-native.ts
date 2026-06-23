// Re-exports the entire react-native surface, replacing Text with our
// Quicksand-defaulting wrapper.  The metro.config.js resolver redirects every
// `import … from 'react-native'` in app source code here; this file itself
// is excluded from that redirect so it can safely import the real package.
export * from 'react-native'
export { Text } from './Text'
