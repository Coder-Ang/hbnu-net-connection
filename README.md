头晕的时候利用cursor做了一个校园网自动连接工具demo，采用electron实现
主要是思路，一般这种工具两种方式来做：1.抓包获取校园网连接地址，然后模拟发请求，但一般校园网认证都有安全措施的，因此这种方式不可行，故本demo采取第二种
2.RPA自动化，打开网页模拟人类操作实现登陆，此时只需要将网页嵌入到客户端中并隐藏起来，用户看不到操作过程（其实底层是打开浏览器帮你输密码然后点登陆），达到自动连接的效果，具体自动化的代码其实很好写，把校园网连接网站的html下下来，让AI写就好了，这部分没什么技术含量，且繁杂
