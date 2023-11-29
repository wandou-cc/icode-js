const npmlog = require('npmlog')

npmlog.level = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info'
npmlog.heading = 'icode'
npmlog.addLevel("success", 3001, { fg: "green", bold: true })

exports.icodeLog = npmlog