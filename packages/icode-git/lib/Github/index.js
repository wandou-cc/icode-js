// https://docs.github.com/zh/rest/packages/packages?apiVersion=2022-11-28
const GithubRequest = require('./request')

class Github {
    constructor(token) {
        this.request = new GithubRequest(token)
    }

    getTokenUrl() {
        return 'https://github.com/settings/tokens'
    }

    getTokenHelpUrl() {
        return 'https://docs.github.com/en/github/authenticating-to-github/connecting-to-github-with-ssh'
    }

    getUser() {
        return this.request.get('/user').then(res => {
            if (res && res.status) {
                throw new Error(res.data.message)
            }
            return res
        })
    }

    // 获取组织信息
    getOrg() {
        return this.request.get(`/user/orgs`, {
            page: 1,
            per_page: 100
        }).then(res => {
            if (res && res.status) {
                throw new Error(res.data.message)
            }
            return res
        })
    }

    // 查找是否有该仓库
    getOriginRepo(login, name) {
        return this.request.get(`/repos/${login}/${name}`).then(res => {
            if (!res.id && res.status) {
                if(res.status == '404') return false
                throw new Error(res.statusText)
            }
            return res
        })
    }

    // 创建个人仓库
    createUserRepo(name) {
        return this.request.post('/user/repos', { name },
            {
                Accept: 'application/vnd.github.v3+json',
            }).then(res => {
                if (res && !res.name) {
                    throw new Error(res.status)
                }
                return res
            })
    }

    // 创建仓库
    createOrgsRepo(name, login) {
        return this.request.post(`/orgs/${login}/repos`, {
            name
        }, {
            Accept: 'application/vnd.github.v3+json',
        }).then(res => {
            if (res && !res.name) {
                throw new Error(res.status)
            }
            return res
        })
    }
    getRepoteBranchList(login, name) {
        return this.request.get(`/repos/${login}/${name}/branches`).then(res => {
            if(res && res.statusText && res.status !== 404) {
                throw new Error(res.statusText)
            }
            if(res.status == 404) return []
            else return res
        })
    }

    // 检查分支是不是受保护分支
    checkProteceBranch(login, name, branch) {
        return this.request.get(`/repos/${login}/${name}/branches/${branch}`).then(res => {
            return res.protected
        })
    }

    // 提交合并请求
    pullRequire(login, name, { title, base, head, body }) {
        return this.request.post(`/repos/${login}/${name}/pulls`, {
            title,
            head,
            base,
            body
        }).then(res => {
            if(!res.id) {
                throw new Error(res?.data?.errors[0].message)
            } else {
                return res
            }
        })
    }

    // 获取仓库协作用户
    getCollaborators(login, name) {
        return this.request.get(`/repos/${login}/${name}/collaborators`).then(res => {
            if(res?.length??0) {
                return res
            }
            return []
        })
    }

    // 获取仓库合并列表
    getPullRequestList(login, name) {
        return this.request.get(`/repos/${login}/${name}/pulls`).then(res => {
            if(res.length !== 0) {
                return res
            }
            return []
        })
    }
 
    // 同意某个合并请求
    agreePullRequest(login, name, pullNumber) {
        return this.request.put(`/repos/${login}/${name}/pulls/${pullNumber}/merge`, {
            merge_method: 'merge'
        }).then(res => {
            if(res.state) {
                throw new Error(res)
            }
            return res
        })
    }   

    // 更新合并请求
    requestedReviewers(login, name, number, reviewList) {
        return this.request.post(`/repos/${login}/${name}/pulls/${number}`, {
            reviewers: reviewList,
            state: 'open',
        }).then(res => {
            if(res.status) {
                throw new Error(res)
            }
            return res
        })
    }



}

module.exports = Github