#!/usr/bin/env node

const importLocal = require('import-local')
const { icodeLog } = require('@icode-js/icode-shared-utils')

if(importLocal(__filename)) {
    icodeLog.info('cli', '正在使用当前node_modules中的icode-js')
} else {
    require('../lib')(process.argv.slice(2))
}

