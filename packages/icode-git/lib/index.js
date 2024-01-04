const { simpleGit } = require('simple-git')

class icodeGit {
    constructor({ path }) {
        this.git = simpleGit(path)
        this.gitInstance = null
        // this.user = null
        // this.orgs = null
        this.repo = null
        this.login = null
        this.name = null
    }

    // 判断远程有没有当前仓库
    async thereRemoteRepo(login, name) {
        this.repo = await this.gitInstance.getOriginRepo(login, name)
        return this.repo
    }

    // 创建个人仓库
    async createUserRepo(name) {
        this.repo = await this.gitInstance.createUserRepo(name)
        return this.repo
    }

    // 创建组织仓库
    async createOrgsRepo(login, name) {
        this.repo = await this.gitInstance.createOrgsRepo(name, login)
        return this.repo
    }

    // 获取个人信息以及组织信息
    async getGitUserAndOrgs() {
        try {
            const user = await this.gitInstance.getUser()
            const orgs = await this.gitInstance.getOrg(user.login)
            return { user, orgs }
        } catch (e) {
            throw new Error(e)
        }
    }

    // 生成某个git平台的实例
    async createGitServer(gitserver, token) {
        const gitProviderMap = {
            'gitee': require('./Gitee'),
            'github': require('./Github'),
            'gitlab': require('./Gitlab'),
            'default': require('./CompanyGitlab')
        }
        const GitProvider = gitProviderMap[gitserver] || gitProviderMap['default']
        this.gitInstance = new GitProvider(token)
        return this.gitInstance
    }

    // 查看当前项目有没有关联远程地址
    async getRemotes() {
        let remotes = await this.git.getRemotes()
        return remotes
    }

    async getRepoDetails() {
        try {
            const remotes = await this.git.getRemotes(true)
            const origin = remotes.find(remote => remote.name === 'origin')
            if (origin) {
                const urlParts = origin.refs.fetch.split('/')
                const repoName = urlParts[urlParts.length - 1].replace(/\.git$/, '')
                return repoName
            } else {
                return null
            }
        } catch (err) {
            throw new Error(err)
        }
    }

    // 关联远程地址
    async remoteOrigin(gitUrl) {
        this.git.remote(['add', 'origin', gitUrl], (error, result) => {
            if (error) {
                throw new Error(error)
            } else {
                return result
            }
        })
    }

    // 删除关联地址
    async deleteRemoteOrigin(name = 'origin') {
        this.git.remote(['remove', name], (error) => {
            if (error) {
                throw new Error(error)
            } else {
                return true
            }
        })
    }

    // 初始化本地仓库
    async initLocalGit() {
        try {
            await this.git.init()
        } catch (e) {
            throw new Error(e)
        }
    }

    // 分支重命名
    async moveBranch(branch) {
        try {
            await this.git.branch(['-M', branch])
        } catch (e) {
            throw new Error(e)
        }
    }

    // 获取当前分支名称
    async getCurrentBranch() {
        let localBranchList = await this.getLocalBranchList()
        if (localBranchList.all.length == 0 && !localBranchList.current) {
            return this.repo.default_branch || this.repo.relation
        }
        return localBranchList.current
    }

    // 切换分支
    async checkoutBranch(branch, hasRemote, hasLocal, options = {}) {
        if (!hasLocal && !hasRemote) {
            throw new Error(`${branch}分支不存在,如果您需要新建或者同步远程的${branch}分支。请使用icode checkout 指令`)
        } else {
            await this.git.fetch()
            await this.git.checkout(branch)
        }
    }



    // 新建分支
    /*
        获取本地分支
            如果本地有那就进行切换
            如果没有就进行新建分支
        检查远程是否有当前分支
            有进行拉取
        是否需要同步主分支
    */
    async checkoutLocalBranch(branch) {
        try {
           await this.git.checkout(branch)
        } catch(e) {
            throw new Error(e)
        }
    }

    async createBranch(branch, fromBranch) {
        try {
            await this.git.checkoutBranch(branch, `${fromBranch || this.repo.default_branch || this.repo.relation}`)
        } catch(e) {
            throw new Error(e)
        }
    }

    // 获取本地分支名
    async getLocalBranchList() {
        const localBranchList = await this.git.branchLocal()
        return localBranchList
    }

    // 获取远程所有分支
    async getRemoteBranchList(login, name) {
        // this.remoteList = await this.git.listRemote(['--refs'])
        // let reg = /.+?refs\/heads\/(.*)/
        // return this.remoteList.split('\n').map(item => {
        //     const match = reg.exec(item)
        //     if (match) {
        //         return match[1]
        //     }
        // }).filter(_ => _)
        return await this.gitInstance.getRepoteBranchList(login, name)
    }

    // 拉取分支
    async pullOriginBranch(branch, options) {
        try {
            await this.git.pull('origin', branch, options)
        } catch (e) {
            throw new Error(e)
        }
    }

    // 提交远程分支
    async pushOriginBranch(branchName, options = {}) {
        try {
            await this.git.push(['origin', branchName, ...Object.keys(options)])
        } catch (e) {
            throw new Error(e)
        }
    }

    // 本地合并分支
    async mergeLocalBranch(origin, targer) {
        try {
            await this.git.mergeFromTo(origin, targer)
        } catch (e) {
            throw new Error(e)
        }
    }

    // 检查冲突
    async checkConflicted() {
        const status = await this.git.status()
        if (status.conflicted.length > 0) {
            status.conflicted.forEach(item => {
                throw new Error(`${item}文件冲突`)
            })
        }
    }

    // commit
    async gitAdd() {
        try {
            const status = await this.git.status()
            await this.checkConflicted()
            let { not_added, created, deleted, modified, renamed } = status
            if (not_added.length > 0 || created.length > 0 || deleted.length > 0
                || modified.length > 0 || renamed.length > 0) {
                await this.git.add(not_added)
                await this.git.add(created)
                await this.git.add(deleted)
                await this.git.add(modified)
                await this.git.add(renamed)
            }
        } catch (e) {
            throw new Error(e)
        }
    }

    // 判断仓库是否干净
    async gitClean() {
        const status = await this.git.status()
        let isclean = !status.isClean()
        return isclean
    }

    // commit
    async gitCommit(commitText) {
        await this.git.commit(commitText)
    }


    // 判断当前分支是不是保护分支
    // async checkProteceBranch(login, name, branch) {
    //     try {
    //         return this.gitInstance.checkProteceBranch(login, name, branch)
    //     } catch (e) {
    //         throw new Error(e)
    //     }
    // }

    // 获取协作者
    async getCollaborators(login, name, type = '') {
        try {
            return this.gitInstance.getCollaborators(login, name, type)
        } catch (e) {
            throw new Error(e)
        }
    }

    // 创建合并请求
    async createPullRequest(login, name, data) {
        try {
            return this.gitInstance.pullRequire(login, name, data)
        } catch (e) {
            throw new Error(e)
        }
    }

    // 合并请求列表
    async getPullRequestList(login, name) {
        try {
            return this.gitInstance.getPullRequestList(login, name)
        } catch (e) {
            throw new Error(e)
        }
    }

    // 提交谁来进行合并
    // async requestedReviewers(login, name, number, list) {
    //     try {
    //         return this.gitInstance.requestedReviewers(login, name, number, list)
    //     } catch (e) {
    //         throw new Error(e)
    //     }
    // }

    // 同意合并
    async agreePullRequest(login, name, number) {
        try {
            return this.gitInstance.agreePullRequest(login, name, number)
        } catch (e) {
            throw new Error(e)
        }
    }

    // 同意测试通过
    async reviewPullRequest(login, name, number) {
        try {
            return this.gitInstance.reviewPullRequest(login, name, number)
        } catch (e) {
            throw new Error(e)
        }
    }

    // 同意测试通过
    async reviewTesterRequest(login, name, number) {
        try {
            return this.gitInstance.reviewTesterRequest(login, name, number)
        } catch (e) {
            throw new Error(e)
        }
    }

    // 获取远程tag
    async getRepoTag(login, name) {
        try {
            return this.gitInstance.getRepoTag(login, name)
        } catch (e) {
            throw new Error(e)
        }
    }

    // 提交tag
    async addRepoTag(login, name, tag, message, branch) {
        try {
            return this.gitInstance.addRepoTag(login, name, tag, message, branch)
        } catch (e) {
            throw new Error(e)
        }
    }
}
module.exports = icodeGit
