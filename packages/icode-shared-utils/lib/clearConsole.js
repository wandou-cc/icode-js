
const readline = require('readline')

exports.clearConsole = title => {
    if (process.stdout.isTTY) {
         readline.cursorTo(process.stdout, 0, 0)
         readline.clearScreenDown(process.stdout)
         if (title) {
              console.log(title)
         }
    }
}