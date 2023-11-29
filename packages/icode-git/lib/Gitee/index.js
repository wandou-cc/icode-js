// https://gitee.com/api/v5/swagger#/getV5ReposOwnerRepoStargazers?ex=no
const GiteeRequest = require('./request')


class Gitee {
    constructor(token) {
        this.request = new GiteeRequest(token)
    }

    getUser() {
        return this.request.get('/user').then(res => {
            if (res && res.status) {
                throw new Error(res.statusText)
            }
            return res
        })
    }

    // 获取组织信息
    getOrg(name) {
        return this.request.get(`/users/${name}/orgs`, {
            page: 1,
            per_page: 100
        }).then(res => {
            if (res && res.statusText) {
                throw new Error(res.statusText)
            }
            return res
        })
    }
    // f6d5bd77ad24cca20b95a43bd9b18a03
    // 查找是否有该仓库
    getOriginRepo(login, name) {
        return this.request.get(`/repos/${login}/${name}`).then(res => {
            if (!res.id && res.status) {
                if (res.status == '404') return false
                throw new Error(res.statusText)
            }
            return res
        })
    }

    // 创建个人仓库
    createUserRepo(name) {
        return this.request.post(`/user/repos`, {
            name
        },
            {
                'Content-Type': 'application/json'
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
            name,
        }, {
            'Content-Type': 'application/json'
        }).then(res => {
            if (res && !res.name) {
                throw new Error(res.status)
            }
            return res
        })
    }

    // 获取远程所有的分支列表
    getRepoteBranchList(login, name) {
        return this.request.get(`/repos/${login}/${name}/branches`).then(res => {
            if (res && res.statusText) {
                throw new Error(res.statusText)
            }
            return res
        })
    }

    // 检查分支是不是受保护分支
    checkProteceBranch(login, name, branch) {
        return this.request.get(`/projects/${login}%2F${name}/protected_branches`).then(res => {
            if (res && res.statusText) {
                throw new Error(res.statusText)
            }
            return res
        })
    }

    // 提交合并请求
    pullRequire(login, name, { title, base, head, body, id }) {
        return this.request.post(`/repos/${login}/${name}/pulls`, {
            title,
            head: base,
            base: head,
            assignees: id,
            body: body
        }).then(res => {
            if (!res.id) {
                throw new Error(res?.data?.message || res?.data?.errors[0].message)
            } else {
                return res
            }
        })
    }

    // 获取仓库协作用户
    getCollaborators(login, name, type) {
        // if (type === 'user') {
        //     url = `/projects/${login}%2F${name}/members`
        // } else {
        //     url = `/groups/${login}/members`
        // }

        return this.request.get(`/orgs/${login}/${name}/members?page=1&per_page=100`).then(res => {
            if (res?.length ?? 0) {
                return res
            }
            return []
        })
    }

    // 获取仓库合并列表
    getPullRequestList(login, name) {
        return this.request.get(`/repos/${login}/${name}/pulls`).then(res => {
            if (res.length !== 0) {
                return res
            }
            return []
        })
    }

    // 同意某个合并请求
    reviewPullRequest(login, name, pullNumber) {
        return this.request.post(`/repos/${login}/${name}/pulls/${pullNumber}/review`).then(res => {
            if (!res.id && res) {
                throw new Error(res?.data?.message || res?.data?.errors[0].message)
            } else {
                return res
            }
        })
    }

    // 测试通过
    reviewTesterRequest(login, name, pullNumber) {
        return this.request.post(`/repos/${login}/${name}/pulls/${pullNumber}/test`).then(res => {
            if (!res.id && res) {
                throw new Error(res?.data?.message || res?.data?.errors[0].message)
            } else {
                return res
            }
        })
    }

    // 同意某个合并请求
    agreePullRequest(login, name, pullNumber) {
        return this.request.put(`/repos/${login}/${name}/pulls/${pullNumber}/merge`).then(res => {
            if (res?.merged) {
                throw new Error(res.message)
            } else {
                return res
            }
        })
    }

    // 指派谁来进行合并
    requestedReviewers(login, name, number, reviewList) {
        return this.request.post(`/repos/${login}/${name}/pulls/${number}/assignees`, {
            assignees: reviewList,
        }).then(res => {
            if (res.status) {
                throw new Error(res)
            }
            return res
        })
    }
}

module.exports = Gitee