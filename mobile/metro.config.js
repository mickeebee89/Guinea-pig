const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)

// Redirect every `import … from 'react-native'` in app source code to our
// shim, which re-exports everything from the real package but replaces Text
// with a Nunito-defaulting wrapper.  Node_modules and the shim itself are
// excluded so they keep the original Text (avoids circular resolution).
const originalResolve = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath
  const isNodeModules = origin.includes(path.sep + 'node_modules' + path.sep)
  const isShim = origin.includes(path.join('src', 'shims'))

  if (moduleName === 'react-native' && !isNodeModules && !isShim) {
    return {
      filePath: path.resolve(__dirname, 'src', 'shims', 'react-native.ts'),
      type: 'sourceFile',
    }
  }

  if (originalResolve) return originalResolve(context, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
