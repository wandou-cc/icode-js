
const fs = require('fs-extra')
const path = require('path')
const colors = require('colors')
const { icodeLog } = require('./icodeLog')
const userHome = require('user-home')
const configPath = path.resolve(userHome, '.icode')

exports.checkConfig = () => {
    if(!fs.existsSync(configPath)) {
        fs.writeJsonSync(configPath, {
            configPath: configPath,
            catchProject: {},
            catchServerToken: {}
        }, { spaces: 4 })
    }

    try {
        fs.readJSONSync(configPath, 'utf-8')
    } catch {
        icodeLog.error('', `配置文件解析错误,请删除 ${colors.cyan(configPath)} 文件/或尝试修复成json格式`)
        process.exit()
    }

    return true
}

exports.readConfig = (option) => {
    exports.checkConfig()
    let configResult = fs.readJSONSync(configPath, 'utf-8')
    if(option) {
        return configResult[option]
    } else {
        return configResult
    }
}

exports.writeConfig = (key, value) => {
    exports.checkConfig()
    let configResult = exports.readConfig()
    configResult[key] = value
    try {
        fs.writeJSONSync(configPath, configResult, { spaces: 4 })
        icodeLog.info('success', `${key}: 写入成功🎉`)
    } catch (e) {
        icodeLog.info('error', `${key}: 写入失败😭`)
        icodeLog.error('', e.message)
    }
}

exports.getConfigPath = () => {
    return configPath
}