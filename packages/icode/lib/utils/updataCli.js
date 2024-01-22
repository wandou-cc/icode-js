'use strict';
const axios = require('axios')
const urlJson = require('url-join')
const semver = require('semver')
const { icodeLog } = require('@icode-js/icode-shared-utils')

// 发送请求获取包的信息
function getNpmPackageInfo(packageName, npmOrigin) {
    const npmOriginUrl = npmOrigin || getDefaultOrigin()
    const npmInfoUrl = urlJson(npmOriginUrl, packageName)
    return axios.get(npmInfoUrl).then(res => {
        if (res.status === 200) {
            return res.data
        }
        return []
    }).catch((err) => {
        return Promise.reject(err)
    })
}

// 默认使用 淘宝镜像
function getDefaultOrigin(npmOrigin = false) {
    icodeLog.verbose('', `当前是否是npm源: ${npmOrigin}`)
    return npmOrigin ? 'https://registry.npmjs.org' : 'https://registry.npmmirror.com'
}

// 解析版本号
async function analyZeVersion(packageName, origin) {
    icodeLog.verbose('', '解析版本号中')
    let packageInfo = await getNpmPackageInfo(packageName, origin)
    if (packageInfo) {
        return Object.keys(packageInfo.versions)
    } else {
        return []
    }
}

// 获取大于当前版本的version
function getGtversion(versionList, currentVersion) {
    icodeLog.verbose('', '获取大于当前版本的version')

    return versionList.filter(ver => semver.satisfies(ver, `>${currentVersion}`))
    .sort((a, b) => semver.gt(b, a) ? 1 : -1)
}

// 获取最新版本
exports.getNpmSemverVersion = async (currentVersion, packageName, origin) => {
    icodeLog.verbose('', '获取最新版本')
    let versionList = await analyZeVersion(packageName, origin) 
    let gtVersions = getGtversion(versionList, currentVersion)
    if (gtVersions && gtVersions.length > 0) {
        return gtVersions[0]
    }
    return null
}

exports.getNpmLatestVersion = async (npmName, registry) => {
    let versions = await analyZeVersion(npmName, registry);
    if (versions) {
        return versions.sort((a, b) => semver.gt(b, a))[0];
    }
    return null;
}


