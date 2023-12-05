const { colors, clearConsole } = require('@icode-js/icode-shared-utils')
const pkg = require('../../package.json')

exports.generateTitle = async function () {
    let title = await colors.bold.blue(`v${pkg.version}`)
    clearConsole(title)
}