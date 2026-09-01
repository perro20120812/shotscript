/**
 * ShotScript · 设备指纹（machineId）
 *
 * 生成稳定的本机唯一标识，用于：
 *  - Pro 激活码设备绑定（一码一机，防复制激活文件到多台机器）
 *  - 遥测上报（登入/登出/日活按设备聚合）
 *
 * 组合多源硬件/系统信息做 SHA-256 摘要，取前 32 位十六进制。
 * 任何单一来源缺失都不影响稳定性（尽力而为，失败静默降级）。
 */
'use strict';

const crypto = require('crypto');
const os = require('os');

function machineId() {
  const parts = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.release(),
    os.cpus().length,
    (os.userInfo && os.userInfo().username) || ''
  ];
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'darwin') {
      // macOS: IOPlatformUUID（稳定且唯一）
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
        encoding: 'utf8', timeout: 3000
      });
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out);
      if (m && m[1]) parts.push('uuid:' + m[1]);
    } else if (process.platform === 'win32') {
      // Windows: 主板序列号
      const out = execSync('wmic csproduct get uuid', { encoding: 'utf8', timeout: 3000 });
      const m = /([0-9A-Fa-f-]{36})/.exec(out);
      if (m && m[1]) parts.push('uuid:' + m[1].toUpperCase());
    } else {
      // Linux: /etc/machine-id 或 /var/lib/dbus/machine-id
      const fs = require('fs');
      try { parts.push('mid:' + fs.readFileSync('/etc/machine-id', 'utf8').trim()); }
      catch (_) { try { parts.push('mid:' + fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim()); } catch (_) {} }
    }
  } catch (_) { /* 静默降级 */ }

  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

module.exports = { machineId };
