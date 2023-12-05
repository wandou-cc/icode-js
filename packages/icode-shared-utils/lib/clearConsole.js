
const readline = require('readline')
const colors = require('colors')

exports.clearConsole = title => {
    if (process.stdout.isTTY) {
         readline.cursorTo(process.stdout, 0, 0)
         readline.clearScreenDown(process.stdout)
         if (title) {
              console.log(colors.cyan(`
         _______________ ____________   _________    ____
        /  _/ ____/ __  / __  / ____/  / ____ / /   /  _/
        / // /   / / / / / / / _/     / /    / /    / /    ${colors.white('welcome ❤️ icode cli')}
      _/ // /___/ /_/ / /_/ / /__    / /___ / /____/ /__   ${colors.green('version: ' + title )}
     /___/\____/\_____ /_____/_____/  /_____/______/_____/   
          
           `))
         }
    }
}


