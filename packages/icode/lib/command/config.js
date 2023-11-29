const { icodeLog, readConfig, writeConfig, colors, inquirer, getConfigPath } = require('@icode-js/icode-shared-utils')

class icodeConfig {
    constructor() {
        this.catchConfig = null
    }

    async initCommand() {
        const startTime = new Date().getTime()
        icodeLog.info('', `如果下列选择不能满足您的需求可以进入${colors.cyan(getConfigPath())}进行修改`)
        await this.config()
        const endTime = new Date().getTime()
        icodeLog.info('本次更改配置耗时:', Math.floor((endTime - startTime) / 1000) + '秒')
    }

    async config() {
        let { configType } = await inquirer.prompt({
            name: 'configType',
            message: '请选择修改配置项.',
            type: 'list',
            choices: [
                { name: '删除缓存项目', value: 1 },
                { name: '删除缓存TOKEN', value: 2 },
                { name: '更新缓存TOKEN', value: 3 },
                { name: '删除自定义仓库平台', value: 4 },
                { name: '给某个项目添加受限制的分支', value: 5 },
                { name: '取消', value: 0 },
            ]
        })
        await this.perform(configType)
    }

    async perform(configType) {
        this.catchConfig = readConfig()
        switch (configType) {
            case 1: return await this.deleteCatchProject()
            case 2: return await this.deleteCatchToken()
            case 3: return await this.updataCatchToken()
            case 4: return await this.deleteCatchPlatform()
            case 5: return await this.addProjectBanBanch()
            case 0: return await this.cancelConfig()
        }
    }

    async deleteCatchProject() {
        let key = 'catchProject'
        let currentConfig = this.catchConfig[key]
        let choicesList = []
        Object.keys(currentConfig).forEach(element => {
            choicesList.push({
                name: element,
                value: element
            })
        })

        if (choicesList.length == 0) {
            icodeLog.warn('', '当前配置项为空')
            await this.config()
            return
        }

        let { checkboxList } = await inquirer.prompt({
            type: 'checkbox',
            name: 'checkboxList',
            message: '选择要删除的项目缓存',
            choices: choicesList
        })

        if (checkboxList.length !== 0) {
            checkboxList.forEach(item => delete currentConfig[item])
            writeConfig(key, currentConfig)
        }

    }

    async deleteCatchToken() {
        let key = 'catchServerToken'
        let currentConfig = this.catchConfig[key]
        let choicesList = []
        Object.keys(currentConfig).forEach(element => {
            choicesList.push({
                name: element,
                value: element
            })
        })

        if (choicesList.length == 0) {
            icodeLog.warn('', '当前配置项为空')
            await this.config()
            return
        }

        let { checkboxList } = await inquirer.prompt({
            type: 'checkbox',
            name: 'checkboxList',
            message: '选择要删除的平台Token',
            choices: choicesList
        })

        if (checkboxList.length !== 0) {
            checkboxList.forEach(item => delete currentConfig[item])
            writeConfig(key, currentConfig)
        }
    }

    async updataCatchToken() {
        let key = 'catchServerToken'
        let currentConfig = this.catchConfig[key]
        let choicesList = []
        Object.keys(currentConfig).forEach(element => {
            choicesList.push({
                name: element,
                value: element
            })
        })

        if (choicesList.length == 0) {
            icodeLog.warn('', '当前配置项为空')
            await this.config()
            return
        }
        let { checkoutToken } = await inquirer.prompt({
            type: 'list',
            name: 'checkoutToken',
            message: '选择要更新的平台Token',
            choices: choicesList
        })
        const { token } = await inquirer.prompt({
            type: 'input',
            name: 'token',
            message: `请输入${checkoutToken}平台的Token`,
            default: '',
            validate(value) {
                return !value ? new Error('Token不能为空') : true
            }
        })
        currentConfig[checkoutToken] = token
        writeConfig(key, currentConfig)
    }

    async deleteCatchPlatform() {
        let key = 'companyGitlabConfig'
        let currentConfig = this.catchConfig[key]
        let choicesList = []
        currentConfig.forEach(element => {
            choicesList.push({
                name: element.gitServerName,
                value: element.gitServerName
            })
        })

        if (choicesList.length == 0) {
            icodeLog.warn('', '当前配置项为空')
            await this.config()
            return
        }

        let { companyName } = await inquirer.prompt({
            type: 'list',
            name: 'companyName',
            message: '选择删除的内部平台',
            choices: choicesList
        })

        let indexToRemove = currentConfig.findIndex(item => item.name === companyName)
        currentConfig.splice(indexToRemove, 1)
        writeConfig(key, currentConfig)
    }

    async addProjectBanBanch() {

        let key = 'catchProject'
        let currentConfig = this.catchConfig[key]
        let choicesList = []
        Object.keys(currentConfig).forEach(element => {
            choicesList.push({
                name: element,
                value: element
            })
        })

        if (choicesList.length == 0) {
            icodeLog.warn('', '当前配置项为空')
            await this.config()
            return
        }

        let { banProject } = await inquirer.prompt({
            type: 'list',
            name: 'banProject',
            message: '选择要添加的项目',
            choices: choicesList
        })

        let currentProject = currentConfig[banProject]
        let determine = ''
        if(currentProject?.banMergeBranch && currentProject.banMergeBranch.length !== 0) {
            determine  = (await inquirer.prompt({
                name: 'determine',
                message: `当前项目已经配置${colors.cyan(currentProject.banMergeBranch.join())}保护分支请选择`,
                type: 'list',
                choices: [
                    {
                        name: '覆盖',
                        value: 1
                    },
                    {
                        name: '追加',
                        value: 2
                    }
                ]
            })).determine
        }

        let { inputBanBranchs } = await inquirer.prompt([
            {
                name: 'inputBanBranchs',
                message: '请输入想要保护的分支,空格隔开,比如test dev',
                type: 'input'
            }
        ])

        let banBranchs = []
        if(determine == 1 || !determine) {
            banBranchs = inputBanBranchs.split(' ')
        } else if(determine == 2) {
            banBranchs = [...new Set([...currentProject.banMergeBranch, ...inputBanBranchs.split(' ')])]
        }
        banBranchs = banBranchs.filter(_ => _)
        currentConfig[banProject].banMergeBranch = banBranchs
        writeConfig(key, currentConfig)
    }

    cancelConfig() {
        process.exit()
    }

}

function icodeConfigFun() {
    let icodeconfig = new icodeConfig()
    console.log(icodeConfig)
    icodeconfig.initCommand()
}

module.exports = icodeConfigFun