// https://docs.gitlab.cn/jh/api/templates/gitignores.html
const GitlabRequest = require('./request')

class Gitlab {
    constructor(token) {
        this.request = new GitlabRequest(token)
        this.time = null
    }

    getUser() {
        return this.request.get('/user').then(res => {
            if (res && res.status) {
                throw new Error(res.data.error_description)
            }
            return res
        })
    }

    // 获取组织信息
    getOrg() {
        return this.request.get(`/groups`, {
            page: 1,
            per_page: 100
        }).then(res => {
            if (res && res.statusText) {
                throw new Error(res.statusText)
            }
            return res
        })
    }

    // 查找是否有该仓库
    getOriginRepo(login, name) {
        return this.request.get(`/projects/${login}%2F${name}`).then(res => {
            if (!res.id && res.status) {
                if (res.status == '404') return false
                throw new Error(res.statusText)
            }
            return res
        })
    }

    // 创建个人仓库
    createUserRepo(name) {
        return this.request.post('/projects', { name },
            {
                'Content-Type': 'application/json'
            }).then(res => {
                if (res && res.statusText) {
                    throw new Error(res.status)
                }
                return res
            })
    }

    // 创建仓库
    createOrgsRepo(name, login) {
        return this.request.post(`projects`, {
            name,
            'namespace_id': login
        }, {
            'Content-Type': 'application/json'
        }).then(res => {
            if (res && res.statusText) {
                throw new Error(res.status)
            }
            return res
        })
    }

    // 获取远程所有的分支列表
    getRepoteBranchList(login, name) {
        return this.request.get(`/projects/${login}%2F${name}/repository/branches`).then(res => {
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
        return this.request.post(`/projects/${login}%2F${name}/merge_requests`, {
            title,
            target_branch: head,
            source_branch: base,
            assignee_id: id,
            description: body
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
        return this.request.get(`/projects/${login}%2F${name}/members/all?page=1&per_page=100`).then(res => {
            if (res?.length ?? 0) {
                let inquirerUserList = []
                inquirerUserList = res.reduce((acc, cur) => {
                    if ([40, 50].includes(cur.access_level)) {
                        acc.push({
                            name: cur.username,
                            value: cur.id
                        })
                    }
                    return acc
                }, inquirerUserList)
                return inquirerUserList
            }
            return []
        })
    }

    // 获取仓库合并列表
    getPullRequestList(login, name) {
        return this.request.get(`/projects/${login}%2F${name}/merge_requests?state=opened`).then(res => {
            if (res.length !== 0) {
                return res
            }
            return []
        })
    }

    getPullRequestStatus(login, name, pullNumber) {
        return new Promise((resolve, reject) => {
            this.request.get(`/projects/${login}%2F${name}/merge_requests/${pullNumber}`).then(res => {
                if (res.merge_status == 'checking') {
                    resolve(false)
                } else if (res.merge_status == 'can_be_merged') {
                    resolve(true)
                } else {
                    reject('可能不包含任何更改或者有冲突,请去网页查看')
                }
            })
        })
    }

    // 同意某个合并请求
    async agreePullRequest(login, name, pullNumber) {

        for (let i = 0; i < 10; i++) {
            try {
                let status = await this.getPullRequestStatus(login, name, pullNumber)
                if (status) {
                    break
                }
            } catch (e) {
                throw new Error(e)
            }
        }

        return this.request.put(`/projects/${login}%2F${name}/merge_requests/${pullNumber}/merge`).then(res => {
            if (res.status) {
                let errorText = null
                switch (res.status) {
                    case 401: errorText = '没有接受这个合并请求的权限'; break;
                    case 405: errorText = '这个合并请求不能被接受'; break;
                    case 422: errorText = '合并请求无法被合并'; break;
                }
                throw new Error(errorText)
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
            if (res.status) {
                throw new Error(res)
            }
            return res
        })
    }

    // 获取tag
    getRepoTag(login, name) {
        return this.request.get(`/projects/${login}%2F${name}/repository/tags`).then(res => {
            if (res.status) {
                throw new Error(res)
            }
            return res
        })
    }

    addRepoTag(login, name, tag_name, message, branch) {
        return this.request.post(`/projects/${login}%2F${name}/repository/tags`, {
            tag_name,
            ref: branch,
            message
        }).then(res => {
            if (res.status) {
                throw new Error(res)
            }
            return res
        })
    }

}

module.exports = Gitlab