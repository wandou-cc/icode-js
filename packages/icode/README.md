# icode-js

集成基于`github/gitee/gitlab/公司内部gitlab`提交操作并支持动态更改项目仓库 支持自定义公司内部gitlab项目管理。简化操作，上手简单，只需一条命令提交多个仓库，自动进行拉取、合并、冲突检查。后续将会加入云构建等。  
在第一次使用的时候会又一些配置这个是正常的 比如配置当前项目应该用哪个平台, 配置**token** 等
**token**在这里说明一下 作者并不会获取你的token都是存储在本地的请放心'食用'

## 下载

```sh
npm install -g icode-js
// 如果是mac/linux用户请提权安装，win系统用户不需要
sudo npm i -g icode-js
```

在终端中输入`icode --help` 出现使用帮助 那就🎉恭喜您可以使用了

## command命令

### `checkout`

`checkout <branchName> [baseBranchName] [-p] [-m]`

- `-p, --pushOrigin`: 创建分支并提交到远程
- `-pm, --pullMainBranch`: 是否同步主分支

   用于切换分支或者是新建分支.
   如果本地已经有这个分支就会直接切换并检查远程有没有这个分支,如果远程没有就结束,如果远程有就会拉取
   如果本地没有这个分支就会基于第二个参数新建分支,如果没有写将会以主分支为主进行新建
   如果本地没有远程有也会新建并同步

### `push`

`push [branchName...] [-m] [-o] [--refreshGitServer] [--refreshGitToken] [--notPushCurrent]`

- `-pm, --pullMainBranch`: 是否同步主分支
- `-m, --message`: 提交说明
- `-y, --yes`: 询问项都是yes
- `-o, --origin`: 是否使用远程合并方案 仅仅支持gitlab系列
- `--refreshGitServer`: 更换托管平台
- `--refreshGitToken`: 更换托管平台Token
- `--notPushCurrent`: 不提交当前分支到远程

默认是本地进行切换分支合并提交远程,对于受保护的分支将会直接进行跳过,如果是远程合并方案,有受保护的分支将会去获取有权限的人并提交合并请求.
如果需要使用 `-y` 参数, 建议跟 `-m` 一起使用

### `tag`

`tag`

上线后进行打tag 目前内置了一种tag方案就是`v+时间+版本` 后续会加入其他方案并能实现自主配置方案

### `config`

`config`

进行脚手架的一些配置, 当脚手架执行的时候会在用户主目录生成一个配置文件叫 `.icode` 用来存储Token/项目信息等
这里说一下**给某个项目添加受限制的分支**即可这个选项是为了避免用户在某个项目下没留意当前分支导致合并错误代码的一个功能
比如我们在开发中有test分支dev分支 我们是不应该将这样的分支进行合并到其他分支的 所以我们可以利用这个配置项添加上述两个分支
这样在`push`的时候就会提示是否继续合并还是只提交当前分支

### `info`

`info`

这个命令就是查看当前系统的一些环境变量
