// 增强错误输出 - 对于未知的指令做出错误处理
const program = require('commander')
const { icodeLog, colors } = require('@icode-js/icode-shared-utils')

module.exports = (methodName, log) => {
    program.Command.prototype[methodName] = function (...args) {
        if (methodName === 'unknownOption' && this._allowUnknownOption) {
            return
        }
        this.outputHelp()
        console.log()
        icodeLog.error('', colors.red(log(...args)))
        process.exit(1)
    }
}

