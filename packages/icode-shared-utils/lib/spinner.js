const ora = require('ora')
const colors = require('colors')

async function runWithSpinner(task, message) {
    const spinner = ora('正在' + message + '……').start()
    try {
        const result = await task()
        spinner.succeed(colors.green('Success!') + ' ' + message + '成功')
        return result
    } catch (error) {
        spinner.fail( colors.red('Failed! 🚨') + ' ' + message + '失败')
        throw error
    }
}

exports.runWithSpinner = runWithSpinner
