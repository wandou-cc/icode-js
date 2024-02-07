const { colors, clearConsole, icodeLog, runWithSpinner } = require('@icode-js/icode-shared-utils')
const pkg = require('../../package.json')
const { getNpmSemverVersion } = require('./updataCli')

exports.generateTitle = async function () {
    icodeLog.verbose('', '正在检查版本更新')
    let newPackageVersion = null
    try {
      await runWithSpinner(async () => {
        newPackageVersion = await postAction()
      }, '检查最新版本')
    } catch(e) {
      icodeLog.error('', e.message)
    }

    let title = `
    _______________ ____________   _________    ____
   /  _/ ____/ __  / __  / ____/  / ____ / /   /  _/  
   / // /   / / / / / / / _/     / /    / /    / /     ${colors.white(`welcome ${colors.red('❤️')} icode cli`)}
 _/ // /___/ /_/ / /_/ / /__    / /___ / /____/ /__    ${colors.green('</>')}
/___/\____/\_____ /_____/_____/  /_____/______/_____/    ${colors.green('Current Version: ' + colors.bold.blue(`v${pkg.version}`) )}
${newPackageVersion ? (('\n' + 'Latest Version: ' + colors.bold.red(newPackageVersion)) + ' 更新请输入: ' + colors.bold.yellow('npm install @icode-js/icode -g')) : ''}
      `
    clearConsole(title)
}

async function postAction() {
    const currentVersion = pkg.version
    const currentPkgName = '@icode-js/icode'
    let newPackageVersion = await getNpmSemverVersion(currentVersion, currentPkgName)
    return newPackageVersion
}