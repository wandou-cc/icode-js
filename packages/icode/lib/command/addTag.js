const { icodeLog, readConfig, writeConfig, colors, inquirer, runWithSpinner } = require('@icode-js/icode-shared-utils')
const GitCommand = require('./command-git')
const getCurrentDate = require('../utils/time')

class GitTag extends GitCommand {
    constructor(options) {
        super(options)
        this.options = options
        this.tagType = null
    }

    async initCommand() {
        const startTime = new Date().getTime()
        await this.init()
        await this.addTag()
        const endTime = new Date().getTime()
        icodeLog.info('本次标记tag耗时:', Math.floor((endTime - startTime) / 1000) + '秒')
    }

    async addTag() {
        if (['github', 'gitee'].includes(this.currentServerName)) {
            icodeLog.warn('', '当前不支持除gitlab系列之外的平台,虽然已经已经支持了大部分功能还有一些问题')
            return
        }
        let config = readConfig('catchProject')
        let currentProject = config[this.repoName]
        if (!currentProject?.tagType) {
            icodeLog.info('', '第一次使用需要配置tag模式')
            let tagTypeList = [
                {
                    name: 'v时间_当日tag顺序',
                    value: 1
                }
            ]
            let { tagType } = await inquirer.prompt({
                name: 'tagType',
                message: '选择tag类型',
                type: 'list',
                choices: tagTypeList,
                default: 1
            })
            config[this.repoName]['tagType'] = tagType
            writeConfig('catchProject', config)
        }
        this.tagType = currentProject?.tagType

        if (this.tagType == 1) {
            await this.addOneTag()
        }
    }

    async addOneTag() {
        // 获取上tag
        let lastTag = null
        await runWithSpinner(async () => {
            lastTag = await this.icodeGitServer.getRepoTag(this.login, this.repoName)
        }, '获取tag')
        
        let version = '01'
        let currentTime = getCurrentDate()
        if (lastTag.length !== 0) {
            let lasterTag = ''
            if (lastTag.length != 0) {
                lasterTag = lastTag[0].name
            }
            if (currentTime == lasterTag.split('_')[0].replace('v', '') && lasterTag) {
                version = this.padWithZero(1 + + lasterTag.split('_')[1])
            }
        }
        let nextTag = 'v' + currentTime + '_' + version
        let { resultTag, message } = await inquirer.prompt([
            {
                type: 'input',
                default: nextTag,
                message: 'tag号, 默认系统生成，如果有其他规范请重新输入，如果正确请直接回车',
                name: 'resultTag'
            },
            {
                type: 'input',
                message: '输入备注',
                name: 'message',
                validate: (value) => {
                    return !value ? '备注必填' : true
                }
            }
        ])

        let addTag = null

        await runWithSpinner(async () => {
            addTag = await this.icodeGitServer.addRepoTag(this.login, this.repoName, resultTag, message, this.mainBranch)
        }, '提交tag')
        
        if (addTag.name) {
            icodeLog.success('','🏷️ tag提交成功: ' + colors.cyan(addTag.name))
        }
    }

    padWithZero(num) {
        return num.toString().padStart(2, '0')
    }

}

function addTag(options) {
    let gitTag = new GitTag(options)
    gitTag.initCommand()
}

module.exports = addTag