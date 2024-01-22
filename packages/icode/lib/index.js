'use strict';

const program = require('commander')
const semver = require('semver')
const pkg = require('../package.json')
const { icodeLog, colors, checkConfig } = require('@icode-js/icode-shared-utils')

module.exports = async () => {
    checkNodeVersion(pkg.engines.node)
    checkConfig()
    checkRoot()
    registerCommand()
}

function checkNodeVersion(wanted) {
    if (!semver.satisfies(process.version, wanted, { includePrerelease: true })) {
        icodeLog.error('', `当前Node版本为: ${colors.cyan(process.version)}, 请使用 ${colors.red(wanted)} 版本Node`)
        process.exit()
    }
}

function checkRoot() {
    const rootCheck = require('root-check')
    rootCheck()
}

function registerCommand() {
    program
        .name(Object.keys(pkg.bin)[0])
        .version(`${pkg.version}`)
        .option('-d, --debug', '开启调试模式', false)
        .usage('<command> [options]')

    // program
    //     .command('create <app-name>')
    //     .description('安装模版或者组件')
    //     .option('-f, --force', '强制替换')
    //     .option('-r, --registry <url>', '指定源地址')
    //     .option('-c, --cnpm', '使用cnpm')
    //     .action((projectName, options) => {
    //         require('./command/create')(projectName, options)
    //     })

    program
        .command('checkout <branch-name> [baseBranch-name]')
        .description('切换分支')
        .option('-p, --pushOrigin', '创建并直接提交到远程')
        .option('-pm, --pullMainBranch', '是否同步主分支')
        .action((branchName, baseBranchName, options) => {
            require('./command/checkout')(branchName, baseBranchName, options)
        })

    program
        .command('push [branchName...]')
        .description('提交代码/本地或者远程提交')
        .option('-o, --origin', '使用远程合并方案')
        .option('-y, --yes', '选项全部设置成yes')
        .option('-m, --message <message>', '提交说明')
        .option('-pm, --pullMainBranch', '是否同步主分支')
        .option('--refreshGitServer', '更换托管平台')
        .option('--refreshGitToken', '更换当前项目的托管平台token')
        .option('--notPushCurrent', '不提交当前的开发的分支')
        .action(async (branchs, options) => {
           await require('./command/push')(branchs, options)
        })

    program
        .command('tag')
        .description('打tag')
        .action((options) => {
            require('./command/addTag')(options)
        })

    program
        .command('config')
        .description('更改配置项')
        .action(() => {
            require('./command/config')()
        })

    program
        .command('info')
        .description('查看系统信息')
        .action(() => {
            icodeLog.success('', '环境变量信息:')
            require('envinfo').run(
                {
                    System: ['OS', 'CPU'],
                    Binaries: ['Node', 'Yarn', 'npm'],
                    Browsers: ['Chrome', 'Edge', 'Firefox', 'Safari'],
                    npmGlobalPackages: ['@icode-js/icode']
                },
                {
                    showNotFound: true,
                    duplicates: true,
                    fullTree: true
                }
            ).then(console.log)
        })

    // 开启debug模式
    program
        .on('option:debug', function () {
            process.env.LOG_LEVEL = 'verbose'
            icodeLog.level = process.env.LOG_LEVEL
        });

    program
        .on('command:*', ([cmd]) => {
            program.outputHelp()
            console.log()
            icodeLog.error('', `未知命令 ${colors.cyan(cmd)}`)
            suggestCommands(cmd) // 进行模糊匹配
            process.exit()
        })

    program.on('--help', () => {
        console.log()
        icodeLog.info('', `执行 ${colors.cyan(`icode <command> --help`)} 获取指定命令的详细用法`)
    })

    program.commands.forEach((c) => c.on('--help', () => {
        console.log()
        icodeLog.info('', `执行 ${colors.cyan(`icode <command> --help`)} 获取指定命令的详细用法`)
    }));

    // 重写commander 中的unknownOption 方法进行定制化输出错误
    const enhanceErrorMessages = require('./utils/enhanceErrorMessage')
    enhanceErrorMessages('unknownOption', optionName => {
        return `未知参数 ${colors.yellow(optionName)} `
    })

    // // 缺少command 
    enhanceErrorMessages('missingArgument', argName => {
        return `缺少必需的参数 ${colors.yellow(`<${argName}>`)}`
    })

    enhanceErrorMessages('optionMissingArgument', (option, flag) => {
        return `缺少选项所需的参数: ${colors.yellow(option.flags)}` + (
            flag ? `, ${colors.yellow(flag)}` : ``
        )
    })

    program.parse(process.argv)
}

function suggestCommands(unknownCommand) {
    const leven = require('leven')
    const availableCommands = program.commands.map(cmd => cmd._name)
    let suggestion
    availableCommands.forEach(cmd => {
        const isBestMatch = leven(cmd, unknownCommand) < leven(suggestion || '', unknownCommand)
        if (leven(cmd, unknownCommand) < 3 && isBestMatch) {
            suggestion = cmd
        }
    })

    if (suggestion) {
        console.log()
        icodeLog.info('', colors.red(`您想输入的命令是否是: ${colors.yellow(suggestion)}?`))
    }
}
