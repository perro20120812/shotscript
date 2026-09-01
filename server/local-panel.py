#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ShotScript 本地控制面板（本机 macOS 专用 · Python 3 标准库实现）

用途：
  在本机（127.0.0.1:8800）提供 ShotScript 手机端授权中心的本地监控 + 密钥管理面板。
  面板从手机端授权中心实时拉取累计下载 / 日活 / 登录等真实遥测数据展示，并可在本机
  直接「生成激活码」与「注销激活码」（生成出的激活码客户端可解开 Pro 版）。

启动命令：
  SHOTSCRIPT_SERVER_URL=http://127.0.0.1:8787 \
  SHOTSCRIPT_PANEL_TOKEN=你的管理Token \
  python3 local-panel.py

依赖说明：
  仅使用 Python 3 标准库（http.server / urllib.request / json / os），
  无需安装任何第三方包。
"""

import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HOST = '127.0.0.1'
PORT = 8800
SERVER_URL = os.environ.get('SHOTSCRIPT_SERVER_URL', 'http://127.0.0.1:8787').rstrip('/')
PANEL_TOKEN = os.environ.get('SHOTSCRIPT_PANEL_TOKEN', '')

PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ShotScript 本地控制面板</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif;background:#0d1117;color:#e6edf3;padding:24px 22px 60px;max-width:1080px;margin:0 auto;-webkit-font-smoothing:antialiased}
header{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px}
header h1{font-size:22px;font-weight:700}
header .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#3fb950;margin-right:8px;box-shadow:0 0 8px #3fb95088}
.sub{color:#8b949e;font-size:12px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-bottom:10px}
@media (max-width:900px){.grid{grid-template-columns:repeat(4,1fr)}}
@media (max-width:560px){.grid{grid-template-columns:repeat(2,1fr)}}
.card{background:#161b22;border:1px solid #21262d;border-radius:14px;padding:14px 14px 12px}
.card .k{color:#8b949e;font-size:11px;margin-bottom:6px}
.card .v{font-size:24px;font-weight:700}
.card .v.g{color:#3fb950}.card .v.b{color:#58a6ff}.card .v.o{color:#e3b341}.card .v.p{color:#bc8cff}
.section{font-size:13px;font-weight:600;color:#8b949e;margin:22px 2px 8px;text-transform:uppercase;letter-spacing:.5px}
.bar{display:flex;align-items:flex-end;gap:6px;height:90px;background:#161b22;border:1px solid #21262d;border-radius:14px;padding:16px 12px 22px}
.bar-item{flex:1;background:#58a6ff;border-radius:5px 5px 0 0;min-height:2px;position:relative}
.bar-item .nv{position:absolute;top:-18px;left:0;right:0;text-align:center;font-size:10px;color:#58a6ff;font-weight:600}
.bar-item .lb{position:absolute;bottom:-20px;left:0;right:0;text-align:center;font-size:10px;color:#8b949e}
.tbl-wrap{border-radius:14px;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:13px;background:#161b22;border:1px solid #21262d}
th{color:#8b949e;font-weight:500;text-align:left;padding:10px 12px;border-bottom:1px solid #21262d;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
td{padding:10px 12px;border-bottom:1px solid #1c2128}
tr:last-child td{border-bottom:none}
.badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600}
.badge.team{background:#d2992233;color:#e3b341}
.badge.pers{background:#3fb95033;color:#3fb950}
.ev{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#161b22;border:1px solid #21262d;border-radius:12px;margin-bottom:6px}
.ev .ic{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.ic.login{background:#1f6feb33;color:#58a6ff}.ic.logout{background:#f8514933;color:#f85149}.ic.act{background:#3fb95033;color:#3fb950}.ic.issue{background:#bc8cff33;color:#bc8cff}.ic.revoke{background:#f0883e33;color:#f0883e}.ic.dl{background:#e3b34133;color:#e3b341}
.ev .bd{flex:1;min-width:0}
.ev .bd .u{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ev .bd .t{font-size:11px;color:#8b949e;margin-top:2px}
.ev .tm{font-size:10.5px;color:#6e7681;flex-shrink:0}
.forms{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media (max-width:720px){.forms{grid-template-columns:1fr}}
.form{background:#161b22;border:1px solid #21262d;border-radius:14px;padding:16px}
.form h3{font-size:14px;margin-bottom:12px}
label{display:block;font-size:12px;color:#8b949e;margin-bottom:6px}
input[type=text],input[type=number],textarea{width:100%;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;padding:8px 10px;font-size:13px;margin-bottom:10px}
input:focus,textarea:focus{outline:none;border-color:#58a6ff}
.radios{display:flex;gap:16px;margin-bottom:10px}
.radios label{color:#e6edf3;font-size:13px;margin-bottom:0;display:flex;align-items:center;gap:6px;cursor:pointer}
button{background:#238636;border:none;color:#fff;font-size:13px;font-weight:600;padding:9px 18px;border-radius:8px;cursor:pointer;margin-top:4px}
button:hover{background:#2ea043}
button.alt{background:#1f6feb}
button.alt:hover{background:#388bfd}
.result{margin-top:12px;font-size:13px}
.result .ok{color:#3fb950;margin-bottom:6px}
.result .err{color:#f85149;margin-bottom:6px}
.code-box{width:100%;min-height:70px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#3fb950;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;padding:10px;word-break:break-all;resize:vertical}
footer{margin-top:22px;text-align:center;color:#484f58;font-size:11px}
</style>
</head>
<body>
<header><div><h1><span class="dot"></span>ShotScript 本地控制面板</h1></div><div class="sub" id="upd">-</div></header>
<div class="sub">数据来自手机端授权中心实时采集（下载量 / 日活 / 登录 / 在线等真实遥测），密钥可在本机直接签发与注销。</div>

<div class="grid">
  <div class="card"><div class="k">累计下载</div><div class="v g" id="c-dl">-</div></div>
  <div class="card"><div class="k">今日活跃</div><div class="v b" id="c-now">-</div></div>
  <div class="card"><div class="k">今日登入</div><div class="v" id="c-login">-</div></div>
  <div class="card"><div class="k">今日登出</div><div class="v" id="c-logout">-</div></div>
  <div class="card"><div class="k">个人 Pro</div><div class="v p" id="c-pers">-</div></div>
  <div class="card"><div class="k">团队</div><div class="v" id="c-team">-</div></div>
  <div class="card"><div class="k">当前在线</div><div class="v o" id="c-online">-</div></div>
</div>

<div class="section">近 7 日活跃设备</div>
<div class="bar" id="bar"></div>

<div class="section">当前在线用户</div>
<div class="tbl-wrap"><table><tr><th>uid（唯一ID）</th><th>类型</th><th>登录时间</th></tr><tbody id="tbl"></tbody></table></div>

<div class="section">实时流水（登录 / 登出 / 下载 / 签发 / 注销）</div>
<div id="events"></div>

<div class="section">密钥管理</div>
<div class="forms">
  <div class="form">
    <h3>密钥生成</h3>
    <label>uid（用户ID）</label>
    <input type="text" id="g-uid" placeholder="如 alice 或邮箱/设备标识">
    <label>席位</label>
    <div class="radios">
      <label><input type="radio" name="seats" value="1" checked> 个人 Pro（1 席）</label>
      <label><input type="radio" name="seats" value="5"> 团队（5 席）</label>
    </div>
    <label>有效天数</label>
    <input type="number" id="g-days" value="365" min="1">
    <button onclick="issue()">生成密钥</button>
    <div class="result" id="g-result"></div>
  </div>
  <div class="form">
    <h3>密钥注销</h3>
    <label>激活码（明文）</label>
    <textarea id="r-code" placeholder="粘贴要注销的激活码"></textarea>
    <button class="alt" onclick="revoke()">注销密钥</button>
    <div class="result" id="r-result"></div>
  </div>
</div>

<footer>监控区每 10 秒自动刷新 · 密钥表单不会自动刷新</footer>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function fmt(ts){var d=new Date(ts);var p=function(n){return String(n).padStart(2,'0')};return p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())}

async function loadStats(){
  try{
    var s=await (await fetch('/api/stats')).json();
    c-dl.textContent=s.downloads;c-now.textContent=s.todayActive;c-login.textContent=s.todayLogins;c-logout.textContent=s.todayLogouts;c-pers.textContent=s.personalUsers;c-team.textContent=s.teamUsers;c-online.textContent=s.online.length;
    var mx=1;for(var i=0;i<s.dau.length;i++){if(s.dau[i].active>mx)mx=s.dau[i].active}
    var bh='';
    for(var i=0;i<s.dau.length;i++){var d=s.dau[i];var h=Math.max(3,Math.round(d.active/mx*48));bh+='<div class="bar-item" style="height:'+h+'px"><span class="nv">'+d.active+'</span><span class="lb">'+String(d.day).slice(5)+'</span></div>'}
    bar.innerHTML=bh;
    var rows='';
    for(var i=0;i<s.online.length;i++){var o=s.online[i];var tag=(o.seats>1?'<span class="badge team">团队×'+o.seats+'</span>':'<span class="badge pers">个人</span>');rows+='<tr><td>'+esc(o.uid)+'</td><td>'+tag+'</td><td>'+fmt(o.at)+'</td></tr>'}
    tbl.innerHTML=rows||'<tr><td colspan="3" style="color:#6e7681;text-align:center">暂无在线</td></tr>';
    upd.textContent='更新于 '+fmt(s.serverTime)+' · 数据实时来自手机端授权中心';
  }catch(e){upd.textContent='连接手机端授权中心异常，等待重试…'}
}

async function loadEvents(){
  try{
    var r=await (await fetch('/api/events?limit=50')).json();
    var ic={'-1':'issue','0':'revoke','1':'login','2':'logout','3':'act','5':'dl'};
    var sym={'-1':'签','0':'注','1':'↑','2':'↓','3':'●','5':'↓'};
    var h='';
    for(var i=0;i<r.events.length;i++){
      var e=r.events[i];var c=Number(e.code);
      var lbl=e.label||('#'+c);
      var u=e.uid||(c===5?'下载':(c===0?'注销':'-'));
      h+='<div class="ev"><div class="ic '+(ic[c]||'act')+'">'+(sym[c]||lbl)+'</div><div class="bd"><div class="u">'+esc(u)+'</div><div class="t">'+esc(lbl)+' · '+(e.deviceId?esc(e.deviceId):'')+'</div></div><div class="tm">'+fmt(e.ts)+'</div></div>';
    }
    events.innerHTML=h||'<div class="ev"><div class="bd"><div class="u">暂无记录</div></div></div>';
  }catch(e){}
}

async function issue(){
  var uid=document.getElementById('g-uid').value.trim();
  var seats=Number(document.querySelector('input[name=seats]:checked').value);
  var days=Number(document.getElementById('g-days').value)||365;
  if(!uid){document.getElementById('g-result').innerHTML='<div class="err">请填写 uid</div>';return}
  document.getElementById('g-result').innerHTML='正在签发…';
  var resp;
  try{resp=await fetch('/api/issue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:uid,seats:seats,days:days})})}catch(e){document.getElementById('g-result').innerHTML='<div class="err">无法连接面板服务</div>';return}
  var j=await resp.json();
  if(j.ok){
    var out='<div class="ok">签发成功（'+j.seats+' 席，有效 '+(Number(days)||365)+' 天）</div>';
    out+='<textarea class="code-box" readonly onclick="this.select()">'+esc(j.code)+'</textarea>';
    out+='<button onclick="copyCode(this)" style="margin-top:8px">复制激活码</button>';
    document.getElementById('g-result').innerHTML=out;
  }else{
    document.getElementById('g-result').innerHTML='<div class="err">'+esc(j.message||'签发失败')+'</div>';
  }
}

async function revoke(){
  var code=document.getElementById('r-code').value.trim();
  if(!code){document.getElementById('r-result').innerHTML='<div class="err">请填写要注销的激活码</div>';return}
  document.getElementById('r-result').innerHTML='正在注销…';
  var resp;
  try{resp=await fetch('/api/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code})})}catch(e){document.getElementById('r-result').innerHTML='<div class="err">无法连接面板服务</div>';return}
  var j=await resp.json();
  document.getElementById('r-result').innerHTML=j.ok?'<div class="ok">'+esc(j.message||'已注销')+'</div>':'<div class="err">'+esc(j.message||'注销失败')+'</div>';
}

function copyCode(btn){
  var ta=btn.previousElementSibling;
  ta.focus();ta.select();
  try{document.execCommand('copy')}catch(e){}
  btn.textContent='已复制';
  setTimeout(function(){btn.textContent='复制激活码'},1500);
}

loadStats();loadEvents();
setInterval(function(){loadStats();loadEvents()},10000);
</script>
</body>
</html>
"""


def proxy(method, path, body=None):
    """向手机端授权中心发起请求并原样返回其 JSON。"""
    url = SERVER_URL + path
    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if PANEL_TOKEN:
        req.add_header('Authorization', 'Bearer ' + PANEL_TOKEN)
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read().decode('utf-8')
        try:
            return json.loads(raw)
        except Exception:
            return {'ok': True, 'raw': raw}


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html, status=200):
        body = html.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _safe_proxy(self, method, path, body=None):
        try:
            return proxy(method, path, body)
        except Exception as e:
            return {'ok': False, 'message': '无法连接手机端授权中心: ' + str(e)}

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/':
            self._send_html(PAGE)
            return
        if u.path == '/api/stats':
            self._send_json(self._safe_proxy('GET', '/api/v1/stats'))
            return
        if u.path == '/api/events':
            qs = parse_qs(u.query)
            n = qs.get('limit', ['50'])[0]
            self._send_json(self._safe_proxy('GET', '/api/v1/events?limit=' + n))
            return
        self._send_json({'ok': False, 'message': 'not found'}, 404)

    def do_POST(self):
        u = urlparse(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b''
        try:
            body = json.loads(raw.decode('utf-8') or '{}')
        except Exception:
            self._send_json({'ok': False, 'message': 'bad json'}, 400)
            return
        if u.path == '/api/issue':
            self._send_json(self._safe_proxy('POST', '/api/v1/issue', body))
            return
        if u.path == '/api/revoke':
            self._send_json(self._safe_proxy('POST', '/api/v1/revoke', body))
            return
        self._send_json({'ok': False, 'message': 'not found'}, 404)

    def log_message(self, fmt, *args):
        pass


def main():
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as e:
        print('[ShotScript 本地控制面板] 启动失败: 端口 %d 被占用（%s）' % (PORT, e))
        return
    print('[ShotScript 本地控制面板] 已启动 http://%s:%d' % (HOST, PORT))
    print('  手机端授权中心: %s' % SERVER_URL)
    print('  管理 Token: %s' % ('已配置' if PANEL_TOKEN else '未配置（签发/注销将因鉴权失败而不可用）'))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
