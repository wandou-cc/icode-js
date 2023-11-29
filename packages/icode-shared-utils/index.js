['icodeLog', 'clearConsole', 'config', 'spinner'].forEach(m => {
    Object.assign(exports, require(`./lib/${m}`))
})

exports.colors = require('colors')
exports.inquirer = require('inquirer')