头晕的时候无聊做了一个hbnu的校园网自动连接工具，采用electron实现，AI编码
目前只完成了连接部分，经测试可以点击一键连接，但还有很多功能，例如自动选择校园网Wi-Fi，断线重连等尚未实现
实在没事干的时候再写吧。。

主要是思路，一般这种工具两种方式来做：1.抓包获取校园网连接地址，然后模拟发请求，但一般校园网认证都有安全措施的，因此这种方式不可行，故本项目采取第二种
2.RPA自动化，打开网页模拟人类操作实现登陆，此时只需要将网页嵌入到客户端中并隐藏起来，用户看不到操作过程（其实底层是打开浏览器帮你输密码然后点登陆），达到自动连接的效果



