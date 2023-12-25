const fs = require('fs-extra')
const path = require('path')
const terminalLink = require('terminal-link');
const icodeGit = require('@icode-js/icode-git')
const { icodeLog, readConfig, writeConfig, colors, inquirer, runWithSpinner } = require('@icode-js/icode-shared-utils')
const githelp = require('../utils/gitHelp')
const { generateTitle } = require('../utils/generateTitle')

class GitCommand {
    constructor(options) {
        this.packageJsonInfo = this.checkPackage()
        this.icodeGitServer = new icodeGit(this.packageJsonInfo)  //options icode-git 实例
        this.currentServerName = null
        this.options = options
        this.user = null
        this.orgs = null
        this.login = null
        this.ownerType = null
        this.repo = null
        this.gitUrl = null
        this.mainBranch = 'master'
        this.isNewRepo = false
        this.repoName = null
    }

    async init() {
        return new Promise((resolve, reject) => {
            let chain = Promise.resolve()
            chain = chain.then(() => generateTitle())

            // 检查当前项目有没有.git 文件
            chain = chain.then(async () => {
                await this.checkGitInit()
            })
            // 检查是否有缓存
            chain = chain.then(async () => {
                this.repoName = await this.getRepoName()
                await this.checkPackageCache(this.options)
                if (!['github', 'gitlab', 'gitee'].includes(this.currentServerName)) {
                    let companyConfig = readConfig('companyGitlabConfig')
                    let companyInfo = companyConfig.filter(item => item.name === this.currentServerName)[0]
                    process.env.ICODE_BASRURL = companyInfo.baseUrl + '/api/v4'
                    process.env.ICODE_REMOEURL = companyInfo.remoteUrl
                }
            })
            // 检查是否有token
            chain = chain.then(async () => {
                let token = await this.checkGitServerToken(this.options)
                await this.icodeGitServer.createGitServer(this.currentServerName, token)
            })
            // 设置当前项目应该属于个人还是组织
            chain = chain.then(() => this.checkGitOwner())
            // 检查远程仓库存在不存在
            chain = chain.then(() => this.checkGitRepo())

            // 关联远程地址
            chain = chain.then(() => this.remoteBranch())
        
            chain = chain.then(() => resolve())
        })
    }

    async getRepoName() {
        let remotesName = await this.icodeGitServer.getRepoDetails()
        if (!remotesName) {
            icodeLog.warn('', '当前项目未关联远程仓库,默认将使用项目名称。')
            // remotesName = this.packageJsonInfo.name
            let { name } = await inquirer.prompt({
                type: 'input',
                name: 'name',
                message: '是否是用项目名称,如需更改请输入:',
                default: this.packageJsonInfo.name
            })
            remotesName = name
        }

        return remotesName
    }

    // 查看项目缓存
    async checkPackageCache(parametes) {
        let config = readConfig('catchProject')
        let catchList = Object.keys(config || {})
        let currentProject = config[this.repoName]
        let choicesList = [
            { name: 'Github', value: 'github' },
            { name: 'Gitee', value: 'gitee' },
            { name: 'GitLab', value: 'gitlab' }
        ]

        let companyGitLab = readConfig('companyGitlabConfig')
        if (companyGitLab?.length ?? 0) {
            choicesList.push(...companyGitLab)
        }

        choicesList.push({
            name: '公司内部GitLab',
            value: 'companyGitlab',
        })

        let serverList = choicesList.reduce((acc, current) => {
            acc.push(current.value)
            return acc
        }, [])

        if (catchList.includes(this.repoName) && currentProject?.gitServer && serverList.includes(currentProject.gitServer) && !parametes.refreshGitServer) {
            icodeLog.verbose('', `缓存中存在,托管平台为: ${currentProject?.gitServer}`)
            this.currentServerName = currentProject?.gitServer
            return
        }

        if (parametes.refreshGitServer) {
            await this.icodeGitServer.deleteRemoteOrigin()
        }

        let { gitServer } = await inquirer.prompt({
            type: 'list',
            name: 'gitServer',
            message: '请选择一个平台用于托管项目',
            default: 'github',
            choices: choicesList
        })

        let currentServer = null
        if (gitServer === 'companyGitlab') {
            // 创建相关信息
            currentServer = await this.createCompanyGitlab()
        } else {
            currentServer = gitServer
        }

        let writeConfigObj = {}
        writeConfigObj[this.repoName] = {
            gitServer: currentServer
        }
        this.currentServerName = currentServer
        writeConfig('catchProject', {
            ...config,
            ...writeConfigObj
        })
    }

    // async setBanBranch() {

    // }

    // 查看托管平台token
    async checkGitServerToken(parametes) {
        let config = readConfig('catchServerToken')
        let currentToken = config[this.currentServerName]
        if (!currentToken || parametes.refreshGitToken) {
            icodeLog.info('', `${parametes.refreshGitToken ? '替换' : '增加'}${this.currentServerName}平台Token. Token均为本地存储, 作者并不会获取.`)
            if (['github', 'gitlab', 'gitee'].includes(this.currentServerName)) {
                icodeLog.info(`请点击生成:${terminalLink(colors.cyan(githelp[this.currentServerName]))}`)
            }

            const { token } = await inquirer.prompt({
                type: 'input',
                name: 'token',
                message: '请输入Token',
                default: '',
                validate(value) {
                    return !value ? new Error('Token不能为空') : true
                }
            })

            let serverToken = Object.assign({}, config)
            serverToken[this.currentServerName] = token
            writeConfig('catchServerToken', serverToken)
            currentToken = token
        }

        return currentToken
    }

    // 创建托管平台实例
    async createCompanyGitlab() {
        let { gitServerName, baseUrl, remoteUrl } = await inquirer.prompt([
            {
                type: 'input',
                name: 'gitServerName',
                message: '请输入新建平台名称',
                default: '',
                validate(value) {
                    return !value.length ? new Error('名称不能为空') : true
                }
            },
            {
                type: 'input',
                name: 'baseUrl',
                message: '请输入仓库主域名 https://XXXXX.XX/',
                default: '',
                validate(value) {
                    return !value.length ? new Error('仓库主域名不能为空') : true
                    // const urlPattern = /^(?!https?:\/\/).*\.com$/
                    // return !urlPattern.test(value) ? new Error('不需要输入http:// 或者 https:// 只需要输入[]部分,并以.com/.cn 结尾') : true
                }
            },
            {
                type: 'input',
                name: 'remoteUrl',
                message: '请输入仓库前缀地址 [ssh://git@XXXXX.com]/xxxxxxx.git',
                default: '',
                validate(value) {
                    const urlPattern = /^(https?:\/\/|ssh)/
                    return !urlPattern.test(value) ? new Error('请输入以http:// 或者 https:// 或者 ssh 开头的仓库地址前缀,只需要[]部分') : true
                }
            }
        ])
        let companyGitlabConfig = {
            gitServerName,
            baseUrl,
            remoteUrl
        }
        let config = readConfig('companyGitlabConfig') || []
        config.push({
            ...companyGitlabConfig,
            name: gitServerName,
            value: gitServerName
        })

        writeConfig('companyGitlabConfig', config)

        return gitServerName

    }

    // 获取个人以及组织信息
    async checkGitOwner() {
        let config = readConfig('catchProject')
        let { login, ownerType, orgId } = config[this.repoName]?.owner || {}
        try {
            await runWithSpinner(async () => {
                let { user, orgs } = await this.icodeGitServer.getGitUserAndOrgs()
                this.user = user
                this.orgs = orgs
            }, '获取组织/个人信息')
        } catch (e) {
            icodeLog.error('', e.message)
            process.exit()
        }

        // 证明有
        if (login && ownerType) {
            icodeLog.verbose('', `当前登陆人: ${login}, 仓库类型: ${ownerType}`)
        } else {
            // 没有就需要缓存
            let ownerCatch = {}

            let ownerTypeList = [
                { name: '个人项目', value: 'user' },
                { name: '组织项目', value: 'org' }
            ]
            let ownerTypeUserList = [
                { name: '个人项目', value: 'user' },
            ]

            const { owner } = await inquirer.prompt({
                type: 'list',
                message: '选择当前项目仓库类型',
                name: 'owner',
                default: 'user',
                choices: this.orgs?.length > 0 ? ownerTypeList : ownerTypeUserList
            })
            ownerCatch.ownerType = owner
            if (owner === 'user') {
                ownerCatch.login = this.user.login || this.user.username
            } else {
                ownerCatch.login = (await inquirer.prompt({
                    type: 'list',
                    name: 'login',
                    message: '请选择所属组织',
                    choices: this.orgs.map(item => {
                        return {
                            name: item.name,
                            value: item.login || item.path
                        }
                    })
                })).login

                ownerCatch.orgId = this.orgs.filter(item => item.path === ownerCatch.login)[0]?.id || ''
            }
            config[this.repoName].owner = ownerCatch
            writeConfig('catchProject', config)
            login = ownerCatch.login
            ownerType = ownerCatch.ownerType
            orgId = ownerCatch.orgId
        }
        this.login = login
        this.ownerType = ownerType
        this.orgId = orgId
    }

    // 查询仓库并创建
    async checkGitRepo() {
        let repo = null
        try {
            await runWithSpinner(async () => {
                repo = await this.icodeGitServer.thereRemoteRepo(this.login, this.repoName)
            }, '获取远程仓库')


        } catch (e) {
            icodeLog.error('', e.message)
            process.exit()
        }
        icodeLog.verbose('', `远程是否有当前仓库: ${repo?.id || null}`)
        if (!repo) {
            try {
                if (this.ownerType === 'user') {
                    icodeLog.verbose('', '开始创建个人仓库')
                    // 执行创建个人仓库
                    await runWithSpinner(async () => {
                        repo = await this.icodeGitServer.createUserRepo(this.repoName)
                    }, '创建个人仓库')
                } else if (this.ownerType === 'org') {
                    icodeLog.verbose('', '开始创建组织仓库')
                    // 创建组织仓库
                    let idOrName = this.login
                    if (this.ownerType == 'org') {
                        switch (this.currentServerName) {
                            case 'github': idOrName = this.login; break
                            case 'gitee': idOrName = this.login; break
                            default: idOrName = this.orgId
                        }
                    }
                    await runWithSpinner(async () => {
                        repo = await this.icodeGitServer.createOrgsRepo(idOrName, this.repoName)
                    }, '创建组织仓库')
                }
                icodeLog.info('', `仓库创建成功,仓库id: ${repo.id}`)
                this.isNewRepo = true
            } catch (e) {
                icodeLog.error('', e.message)
                process.exit()
            }
        }
        this.repo = repo
        this.mainBranch = this.repo.default_branch || 'master'
        this.gitUrl = this.repo?.clone_url || this.repo?.ssh_url || this.repo?.ssh_url_to_repo
        if (this.isNewRepo) {
            await this.icodeGitServer.moveBranch(this.mainBranch)
        }
    }

    // 初始化本地git
    async checkGitInit() {
        const gitPath = path.resolve(this.packageJsonInfo.projectPath, '.git')
        if (fs.existsSync(gitPath)) {
            icodeLog.verbose('', '本地存在.git,无需初始化')
        } else {
            icodeLog.verbose('', '初始化本地仓库')
            try {
                await runWithSpinner(async () => {
                    await this.icodeGitServer.initLocalGit()
                }, '初始化本地仓库')
                this.isNewRepo = true
            } catch (e) {
                icodeLog.error('', e.message)
            }
        }
    }

    // 关联远程地址
    async remoteBranch() {
        let remotes = null
        await runWithSpinner(async () => {
            remotes = await this.icodeGitServer.getRemotes()
        }, '获取关联地址')

        if (remotes.length === 0 || remotes.find(item => item.name !== 'origin')) {
            icodeLog.verbose('', '没有关联远程地址')
            try {
                icodeLog.info('', `关联地址: ${this.gitUrl}`)
                await this.icodeGitServer.remoteOrigin(this.gitUrl)
                icodeLog.success('', '远程地址关联成功')
            } catch (e) {
                icodeLog.error('', e.message)
            }
        }
    }

    checkPackage() {
        const projectPath = process.cwd()
        const name = path.basename(projectPath)

        // const pkgPath = path.resolve(projectPath, 'package.json')
        // if (!fs.existsSync(pkgPath)) {
        //     icodeLog.warn('', '当前目录' + projectPath)
        //     icodeLog.error('', '找不到package.json')
        //     process.exit()
        // }

        // const pkg = fs.readJSONSync(pkgPath)
        // const { name, version } = pkg
        // if (!name || !version) {
        //     icodeLog.error('', 'package.json缺少配置项')
        //     process.exit()
        // }

        return {
            name,
            projectPath
        }
    }

}

// function command(options) {
//     let gitCommand = new GitCommand(options)

//     console.log(gitCommand)

// }

module.exports = GitCommand