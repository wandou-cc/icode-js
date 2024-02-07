
const { icodeLog, readConfig, inquirer, colors, runWithSpinner } = require('@icode-js/icode-shared-utils')
const GitCommand = require('./command-git')
// const inquirer = require('inquirer')

class GitPush extends GitCommand {
    constructor(branchList, options) {
        super(options)
        this.branchList = branchList
        this.waitBranchList = []
        this.options = options
        this.currentBranch = null
        this.originBranch = null
        this.remoteBranchList = []
        this.mainBranch = null
        this.pullrequest = null
        this.proteceBranchList = null
        this.assignees = null
    }

    async initCommand() {
        const startTime = new Date().getTime()
        await this.init()
        await this.pushBranch()
        const endTime = new Date().getTime()
        icodeLog.info('本次push耗时:', Math.floor((endTime - startTime) / 1000) + '秒')
    }

    async createWaitBranchList() {
        let banMergeBanch = readConfig(`catchProject`)[this.remoteInfo.repoName]
        let mergeStrategy = ''
        let waitBranchList = []
        // 当配置了禁止合并的分支然后还有其他合并的时候需要进行警告
        if (banMergeBanch?.banMergeBranch?.includes(this.originBranch) && this.branchList.length !== 0) {
            icodeLog.warn('', `当前操作分支为${colors.cyan(this.originBranch)} 包含在配置${colors.red('受限制')}的分支列表中, 请再次确定是否将本分支合并到其他分支`)
            let { hasBanBranchConfirm } = await inquirer.prompt({
                name: 'hasBanBranchConfirm',
                type: 'list',
                message: `选择某个策略进行合并`,
                default: '1',
                choices: [
                    { name: `只合并${this.originBranch}`, value: '1' },
                    { name: `无视警告依旧合并`, value: '2' },
                    { name: `取消`, value: '3' }
                ]
            })
            mergeStrategy = hasBanBranchConfirm
        }

        if (mergeStrategy === '1') {
            this.branchList = [this.originBranch]
        } else if (mergeStrategy === '3') {
            process.exit()
        }

        this.branchList.unshift(this.originBranch)
        this.branchList = [...new Set(this.branchList)]

        this.branchList.forEach(branchName => {
            let filterBranch = this.remoteBranchList.filter(item => item.name === branchName)
            let protectedBranch = false // 是否是保护分支
            let merge = true // 是否有merge权限
            let isOriginBranch = false
            let pushOrigin = true // 是否提交到远程
            if (filterBranch.length !== 0) {
                protectedBranch = filterBranch[0].protected
                merge = filterBranch[0].merged
            }

            if (this.originBranch == branchName) {
                isOriginBranch = true
            }

            if (this.options?.notPushCurrent && this.originBranch == branchName) {
                pushOrigin = false
            }

            waitBranchList.push({
                name: branchName,
                protected: protectedBranch,
                merge: merge,
                isOriginBranch: isOriginBranch,
                pushOrigin: pushOrigin
            })
        })
        return waitBranchList
    }

    async pushBranch() {
        // 暂存当前执行命令的分支
        this.originBranch = await this.icodeGitServer.getCurrentBranch()
        try {
            await runWithSpinner(async () => {
                this.remoteBranchList = await this.icodeGitServer.getRemoteBranchList(this.login, this.remoteInfo.repoName)
            }, '获取远程所有分支')
        } catch(e) {
            icodeLog.error('', e.message)
            process.exit()
        }
        this.waitBranchList = await this.createWaitBranchList()
        this.localBranchList = await this.icodeGitServer.getLocalBranchList()
        if (this.options?.origin) {
            if (['github', 'gitee'].includes(this.currentServerName)) {
                icodeLog.warn('', '当前仅仅支持gitlab/gitee,虽然github/gitee也支持了部分功能,还是有很多不确定的情况,本次远程合并将仅仅提交本分支到远程,后续会继续开发其他平台')
                return
            }
            // 远程合并逻辑
            if (this.branchList.length !== 0) {
                await this.originMergeBranch()
            }
        } else {
            // 走本地合并
            await this.localMergeBranch()
        }
    }

    async localMergeBranch() {
        if (!this.options?.yes) {
            let { hasConfirm } = await inquirer.prompt([
                {
                    name: 'hasConfirm',
                    type: 'confirm',
                    message: `是否确定将${this.originBranch}提交合并到${this.branchList.join()}`,
                    default: true
                }
            ])

            if (!hasConfirm) {
                return
            }
        }

        for (let index = 0; index < this.waitBranchList.length; index++) {
            let branchName = this.waitBranchList[index].name
            icodeLog.info('', `${branchName}分支是否是受保护的分支: ${this.waitBranchList[index].protected}`)
            if (this.waitBranchList[index].protected && this.ownerType === 'org') {
                icodeLog.error('', `${branchName} 分支是受保护的分支,停止切换分支等操作`)
                continue
            }
            if (!this.waitBranchList[index].pushOrigin) {
                icodeLog.info('', `${branchName}分支不进行提交远程`)
                if (await this.icodeGitServer.gitClean()) {
                    await this.icodeGitServer.gitAdd()
                    await this.icodeGitServer.gitCommit(await this.commitGit())
                }
                continue
            }

            let deviate = false
            if (!this.waitBranchList[index].isOriginBranch) {
                let { hasLocal, hasRemote } = await this.checkCurrentBranchHas(branchName)
                if (!hasLocal && hasRemote) deviate = true
                try {
                    await this.icodeGitServer.checkoutBranch(branchName, hasRemote, hasLocal)
                } catch (e) {
                    icodeLog.error('', e.message)
                    continue
                }
            }
            await this.processPush(this.waitBranchList[index], deviate)
        }
    }

    async checkCurrentBranchHas(branch) {
        let hasLocal = this.localBranchList.all.indexOf(branch) >= 0
        let hasRemote = this.remoteBranchList.filter(item => item.name === branch).length !== 0

        return {
            hasLocal,
            hasRemote
        }
    }


    async askOriginTitle() {

        if (!this.options?.yes) {
            let { hasConfirm } = await inquirer.prompt([
                {
                    name: 'hasConfirm',
                    type: 'confirm',
                    message: `是否确定将${this.originBranch}提交合并到${this.branchList.join()}`,
                    default: true
                }
            ])

            if (!hasConfirm) {
                return
            }
        }

        let title = this.options?.message, body = ''

        if (!this.options?.yes || !this.options?.message) {
            ({ title, body } = await inquirer.prompt([
                {
                    name: 'title',
                    type: 'input',
                    message: '请输入合并标题(必填)',
                    default: this.options?.message || '',
                    validate: (value) => {
                        return !value ? '请输入标题' : true
                    }
                }, {
                    name: 'body',
                    type: 'input',
                    message: '请输入合并备注(选填)'
                }
            ]))
        }

        return {
            title, body
        }
    }

    async originMergeBranch() {
        let { title, body } = await this.askOriginTitle()
        let hasProtected = this.waitBranchList.filter(item => item.protected)
        // 如果当前有受保护的分支 并 是组织项目 就要获取当前有权限的人
        if (hasProtected.length !== 0 && this.ownerType == 'org') {
            icodeLog.info('', '分支列表中有受保护的分支, 正在获取有权限的合并人')
            let inquirerUserList = await this.getUserList()
            let reviewers = await this.chooseUser(inquirerUserList)
            this.assignees = reviewers
        } else {
            this.assignees = this.user.id
        }

        for (let i = 0; i < this.waitBranchList.length; i++) {

            icodeLog.info('', `正在处理${this.waitBranchList[i].name}`)
            // icodeLog.info('', `${JSON.stringify(this.waitBranchList[i])}`)

            try {
                if (this.options.notPushCurrent) {
                    icodeLog.warn('', '远程提交合并notPushCurrent参数无效将会正常提交到远程')
                }

                if (this.waitBranchList[i].isOriginBranch) {
                    await this.processPush(this.waitBranchList[i])
                    continue
                }

                let hasBranch = this.remoteBranchList.filter(item => item.name === this.branchList[i])
                if (hasBranch.length <= 0) {
                    throw new Error(`${this.branchList[i]}远程没有该分支, 不能发起合并请求`)
                }

                let assignees = this.waitBranchList[i].protected ? this.assignees : this.user.id

                // 检查是否有正在等待合并的请求
                // await this.checkPullRequest()

                // 创建合并请求
                let pullrequest = await this.icodeGitServer.createPullRequest(this.login, this.remoteInfo.repoName, {
                    title,
                    body,
                    head: this.branchList[i],
                    base: this.originBranch,
                    id: assignees
                })

                this.pullrequest = pullrequest

                if (this.currentServerName === 'gitee') {
                    let assigneeList = this.pullrequest.assignees
                    let testerList = this.pullrequest.testers
                    let assigneesNameList = []
                    let testerNameList = []
                    assigneeList.reduce((acc, cur) => {
                        assigneesNameList.push(cur.login)
                        return acc
                    }, [])
                    testerList.reduce((acc, cur) => {
                        testerNameList.push(cur.login)
                        return acc
                    }, [])

                    if (assigneesNameList.includes(this.user.login)) {
                        icodeLog.verbose('', '审批人包含自己直接进行合并')
                        await this.icodeGitServer.reviewPullRequest(this.login, this.remoteInfo.repoName, pullrequest.number)
                    }

                    if (testerNameList.includes(this.user.login)) {
                        icodeLog.verbose('', '测试人包含自己直接进行合并')
                        await this.icodeGitServer.reviewTesterRequest(this.login, this.remoteInfo.repoName, pullrequest.number)
                    }

                    if (assigneesNameList.includes(this.user.login)) {
                        icodeLog.verbose('', '审批人包含自己直接进行合并')
                        await this.icodeGitServer.agreePullRequest(this.login, this.remoteInfo.repoName, pullrequest.number)
                    }

                } else {
                    if (pullrequest.assignee.username === this.user.username) {
                        await runWithSpinner(async () => {
                            await this.icodeGitServer.agreePullRequest(this.login, this.remoteInfo.repoName, pullrequest.iid)
                        }, '合并')
                    }
                }

            } catch (e) {
                icodeLog.error('', e.message)
                // process.exit()
            }
        }
    }

    // 检查是否有相同分支的pr 暂时不在前台进行调用 代码可用
    async checkPullRequest() {
        let pullList = await this.icodeGitServer.getPullRequestList(this.login, this.remoteInfo.repoName)
        // let haspull = null
        if (pullList.length !== 0) {
            haspull = pullList.filter(item => item.source_branch == this.originBranch)
        }
        return true
        // if (haspull && haspull.length !== 0) {
        //     throw new Error(`${this.originBranch}分支有未合并的请求,当前请求提交失败!`)
        // }
    }

    async getUserList() {
        let userList = null
        await runWithSpinner(async () => {
            userList = await this.icodeGitServer.getCollaborators(this.login, this.remoteInfo.repoName, this.ownerType)
        }, '获取协作用户')
        return userList
    }

    async chooseUser(inquirerUserList) {
        // 选择合并人
        const { reviewers } = await inquirer.prompt([
            {
                name: 'reviewers',
                type: 'list',
                message: '选择合并人,选择自己将会由脚手架执行合并',
                default: 'fix',
                choices: inquirerUserList,
                validate: (list) => {
                    return list.length > 0 ? true : '必须选择一个合并人'
                }
            }
        ])

        return reviewers
    }

    async processPush(branch, deviate = false) {
        try {
            this.currentBranch = await this.icodeGitServer.getCurrentBranch() || 'master'
            icodeLog.info('', `当前分支: ${this.currentBranch}`)
            try {
                if (await this.icodeGitServer.gitClean()) {
                    await this.icodeGitServer.gitAdd()
                    await this.icodeGitServer.gitCommit(await this.commitGit())
                }
                // else {
                //     throw new Error('仓库干净,退出！')
                // }
            } catch (e) {
                icodeLog.error('', e.message)
                process.exit()
            }
            // 远程是否有当前分支
            let filterBranch = this.remoteBranchList.filter(item => item.name === this.currentBranch)
            if (filterBranch.length !== 0) {
                let pullOption = {
                    '--no-rebase': true,
                    '--allow-unrelated-histories': true
                }

                await runWithSpinner(async () => {
                    await this.icodeGitServer.pullOriginBranch(this.currentBranch, deviate ? pullOption : {})
                }, `拉取${this.currentBranch}`)

                icodeLog.verbose('', `${this.currentBranch} 分支拉取成功！`)
                await this.checkConflicted()
            } else {
                icodeLog.info('', `远程没有${this.currentBranch}分支,不执行拉取操作`)
            }

            if (this.options.pullMainBranch && this.mainBranch !== this.currentBranch) {
                icodeLog.verbose('', 'pullMainBranch: 生效, 拉取主分支')
                await runWithSpinner(async () => {
                    await this.icodeGitServer.pullOriginBranch(this.mainBranch, {
                        '--no-rebase': true,
                        '--allow-unrelated-histories': true
                    })
                }, '拉取主分支')
                await this.checkConflicted()
            }

            // 合并
            if (!branch.isOriginBranch) {
                await runWithSpinner(async () => {
                    await this.icodeGitServer.mergeLocalBranch(this.originBranch, this.currentBranch)
                }, `把 ${this.originBranch} 合并到 ${this.currentBranch} `)
                icodeLog.verbose('', `把 ${this.originBranch} 合并到 ${this.currentBranch} 成功！`)
                await this.checkConflicted()
            }

            let option = {}
            if (!this.remoteBranchList.includes(this.mainBranch)) {
                option['--set-upstream'] = true
            }

            // 查看当前分支是不是受保护的分支
            // let isProtece = await this.checkBranchIsProtece(this.currentBranch)

            if (this.ownerType === 'org' && branch.protected) {
                throw new Error(`${this.currentBranch} 是保护分支禁止提交`)
            }

            // push
            await runWithSpinner(async () => {
                await this.icodeGitServer.pushOriginBranch(this.currentBranch, option)
            }, `提交${this.currentBranch}`)
            icodeLog.verbose('', '提交代码成功')

        } catch (e) {
            icodeLog.error(e.message)
        }
    }

    async commitGit() {
        if (this.options?.message) {
            return this.options?.message
        }
        const { commitFix } = await inquirer.prompt([
            {
                name: 'commitFix',
                type: 'list',
                message: '选择更改类型',
                default: 'fix',
                choices: [
                    { value: 'feat', name: '📦 feat: 新功能' },
                    { value: 'fix', name: '🔧 fix: 修复问题' },
                    { value: 'docs', name: '📖 docs: 仅仅修改了文档，比如 README, CHANGELOG, CONTRIBUTE等等' },
                    { value: 'style', name: '🎨 style: 仅仅修改了空格、格式缩进、逗号等等，不改变代码逻辑' },
                    { value: 'refactor', name: '🛞 refacto: 重构代码' },
                    { value: 'perf', name: '🤩 perf: 优化相关，比如提升性能、体验' },
                    { value: 'chore', name: '🌈 chore: 改变构建流程、或者增加依赖库、工具等' },
                ]
            }
        ])

        const { commitText } = await inquirer.prompt({
            type: 'text',
            name: 'commitText',
            message: '请输入备注',
            validate(value) {
                return !value ? '备注不能为空' : true
            }
        })
        return commitFix + ': ' + commitText
    }

    async checkBranchIsProtece(branch) {
        let hasProtece = this.remoteBranchList.filter(item => item.name === branch)
        return hasProtece.length > 0 && hasProtece[0].protected
    }

    async checkConflicted() {
        try {
            await runWithSpinner(async () => {
                await this.icodeGitServer.checkConflicted()
            }, '检查冲突')
        } catch (e) {
            icodeLog.error('', e)
            process.exit()
        }
    }
}

function initPush(branchList, options) {
    let gitPush = new GitPush(branchList, options)
    gitPush.initCommand()
}

module.exports = initPush