const { colors, clearConsole } = require('@icode-js/icode-shared-utils')
const pkg = require('../../package.json')

exports.generateTitle = async function () {
    let title = await colors.bold.blue(`icode CLI v${pkg.version}`)
    console.log()
    clearConsole(title)
}