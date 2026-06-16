const { withGradleProperties, withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

function withGradleJvmArgs(config) {
  return withGradleProperties(config, props => {
    const exclude = new Set(['org.gradle.jvmargs', 'org.gradle.native'])
    const existing = props.modResults.filter(p => !exclude.has(p.key))
    props.modResults = [
      ...existing,
      {
        type: 'property',
        key: 'org.gradle.jvmargs',
        value: '-Xmx4g -XX:MaxMetaspaceSize=1g',
      },
      {
        type: 'property',
        key: 'org.gradle.native',
        value: 'false',
      },
    ]
    return props
  })
}

function withGradle8(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const wrapperPath = path.join(
        config.modRequest.platformProjectRoot,
        'gradle/wrapper/gradle-wrapper.properties'
      )
      let contents = fs.readFileSync(wrapperPath, 'utf8')
      contents = contents.replace(
        /distributionUrl=.*/,
        'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.13-bin.zip'
      )
      fs.writeFileSync(wrapperPath, contents)
      return config
    },
  ])
}

module.exports = function withGradleFixes(config) {
  config = withGradleJvmArgs(config)
  config = withGradle8(config)
  return config
}
