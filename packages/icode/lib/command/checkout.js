
const { icodeLog, runWithSpinner, inquirer } = require('@icode-js/icode-shared-utils')
const GitCommand = require('./command-git')
// const inquirer = require('inquirer')
/*
    * checkout 命令如果本地没有当前输入的分支 将会从第二个参数 或者是从主分支进行创建
    * 
*/
class GitCheckout extends GitCommand {
    constructor(branch, baseBranch, options) {
        super(options)
        this.branch = branch
        this.baseBranch = baseBranch
        this.options = options
        this.remoteBranchList = []
    }

    async initCommand() {
        const startTime = new Date().getTime()
        await this.init()
        await this.checkout()
        const endTime = new Date().getTime()
        icodeLog.info('本次checkout耗时:', Math.floor((endTime - startTime) / 1000) + '秒')
    }

    async checkout() {
        let pullOption = {
            '--no-rebase': true,
            '--allow-unrelated-histories': true
        }
        await runWithSpinner(async () => {
            this.remoteBranchList = await this.icodeGitServer.getRemoteBranchList(this.login, this.repoName)
        }, '获取远程所有分支')
        try {
            let hasRemoteCurrentBranch = this.remoteBranchList.filter(item => item.name === this.branch).length !== 0
            let localBranchList = await this.icodeGitServer.getLocalBranchList()
            let hasLocalCurrentBranch = localBranchList.all.includes(this.branch)
            if (hasLocalCurrentBranch) {
                await runWithSpinner(async () => {
                    await this.icodeGitServer.checkoutLocalBranch(this.branch)
                }, `切换${this.branch}分支`)
            } else {
                let { hasConfirm } = await inquirer.prompt([
                    {
                        name: 'hasConfirm',
                        type: 'confirm',
                        message: `本地没有该分支是否新建分支?`,
                        default: true
                    }
                ])
                if (hasConfirm) {
                    await runWithSpinner(async () => {
                        await this.icodeGitServer.createBranch(this.branch, this.baseBranch)
                    }, `新建${this.branch}分支`)
                }
            }

            if (this.options?.pullMainBranch) {
                await runWithSpinner(async () => {
                    await this.icodeGitServer.pullOriginBranch(this.repo.default_branch || this.repo.relation, pullOption)
                }, `拉取主分支`)
            }

            // 远程是否有当前分支
            if (hasRemoteCurrentBranch) {
                await runWithSpinner(async () => {
                    await this.icodeGitServer.pullOriginBranch(this.branch, pullOption)
                }, `拉取${this.branch}分支`)
                icodeLog.verbose('', `${this.branch} 分支拉取成功！`)
            } else {
                icodeLog.verbose('', `远程没有${this.branch}分支,不执行拉取操作`)
            }

            // 提交远程
            if (this.options?.pushOrigin) {
                await runWithSpinner(async () => {
                    await this.icodeGitServer.pushOriginBranch(this.branch)
                }, `提交${this.branch}分支`)
            }
        } catch (e) {
            icodeLog.error('', e.message)
        }
    }
}

function initCheckout(branch, baseBranch, options) {
    let gitCheckout = new GitCheckout(branch, baseBranch, options)
    gitCheckout.initCommand()
}

module.exports = initCheckout