const axios = require('axios')

class GitlabRequest {
    constructor(token) {
        this.token = token
        this.BASE_URL = process.env.ICODE_BASRURL

        this.service = axios.create({
            baseURL: this.BASE_URL,
            timeout: 10000,
        })
        
        this.service.interceptors.request.use(
            config => {
                config.headers['Authorization'] = `Bearer ${this.token}`
                return config
            },
            error => {
                Promise.reject(error)
            },
        )
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
            params,
            method: 'get',
            headers,
        })
    }

    post(url, data, headers) {
        return this.service({
            url,
            data,
            method: 'post',
            headers,
        })
    }

    put(url,data,headers) {
        return this.service({
            url,
            method: 'put',
            data,
            headers
        })
    }
}

module.exports = GitlabRequest
