const axios = require('axios')
const BASE_URL = 'https://gitee.com/api/v5'

class GiteeRequest {
    constructor(token) {
        this.token = token
        this.service = axios.create({
            baseURL: BASE_URL,
            timeout: 10000,
        })
        // this.service.interceptors.request.use(
        //     config => {
        //         config.headers['Authorization'] = `token ${this.token}`
        //         return config
        //     },
        //     error => {
        //         Promise.reject(error)
        //     },
        // )
        this.service.interceptors.response.use(
            response => {
                return response.data
            },
            error => {
                if (error.response && error.response.data) {
                    return error.response
                } else {
                    return Promise.reject(error)
                }
            },
        )
    }
    get(url, params, headers) {
        return this.service({
            url,
            params: {
                ...params,
                access_token: this.token,
            },
            method: 'get',
            headers,
        });
    }

    post(url, data, headers) {
        return this.service({
            url,
            params: {
                access_token: this.token,
            },
            data,
            method: 'post',
            headers,
        });
    }

    put(url, data, headers) {
        return this.service({
            url,
            method: 'put',
            data,
            params: {
                access_token: this.token,
            },
            headers
        })
    }
}

module.exports = GiteeRequest
