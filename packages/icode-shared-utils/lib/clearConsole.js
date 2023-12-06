
const readline = require('readline')
const colors = require('colors')

exports.clearConsole = (title, newPackageVersion) => {
    if (process.stdout.isTTY) {
         readline.cursorTo(process.stdout, 0, 0)
         readline.clearScreenDown(process.stdout)
         if (title) {
              console.log(colors.cyan(title))
         }
    }
}


