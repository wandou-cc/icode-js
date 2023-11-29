const fs = require('fs-extra')
const path = require('path')
const validataPackageName = require('validate-npm-package-name')
const { icodeLog, colors, inquirer} = require('@icode-js/icode-shared-utils')
const { generateTitle } = require('../utils/generateTitle')

module.exports = async function create(projectName, options) {
    validataPackage(projectName)
    const cwd = process.cwd()
    const targetDir = path.resolve(cwd, projectName || '.')
    const inCurrent = projectName === '.' // 是否在当前目录下生成项目
    const name = inCurrent ? path.relative('../', cwd) : projectName
    if (fs.existsSync(targetDir)) {
        if (options.force) {
            await fs.remove(targetDir)
        } else {
            if (inCurrent) {
                const { ok } = await inquirer.prompt({
                    name: 'ok',
                    type: 'confirm',
                    message: '是否确定在当前项目下新建项目'
                })
                if (!ok) return
            } else {
                await generateTitle()
                const { action } = await inquirer.prompt([
                    {
                        name: 'action',
                        type: 'list',
                        message: `当前目录下有同名项目/文件,请选择:`,
                        choices: [
                            { name: '覆盖', value: 'overwrite' },
                            { name: '合并', value: 'merge' },
                            { name: '取消', value: false }
                        ]
                    }
                ])
                if (!action) return
                if (action == 'overwrite') {
                    await fs.remove(targetDir)
                }
            }
        }
    }

}

function validataPackage(projectName) {
    const result = validataPackageName(projectName)
    if (!result.validForNewPackages) {
        icodeLog.error(colors.red(`项目名称无效: "${projectName}"`))
        result.errors && result.errors.forEach(err => {
            icodeLog.error(colors.red('Error: ' + err))
        })
        result.warnings && result.warnings.forEach(warn => {
            icodeLog.error(colors.red('Warning: ' + warn))
        })
        process.exit()
    }
}