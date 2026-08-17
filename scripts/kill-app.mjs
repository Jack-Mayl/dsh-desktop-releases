// Kill all DeepSeek Harness processes by PID (bypasses bash/cmd quoting hell).
import { execSync } from 'node:child_process'
const out = execSync('tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" /FO CSV /NH', { encoding: 'utf8' })
const pids = out.split(/\r?\n/).filter(l => l.includes('DeepSeek')).map(l => l.split('","')[1]).filter(Boolean)
if (pids.length === 0) { console.log('no processes'); process.exit(0) }
for (const pid of pids) {
  try { execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' }); console.log(`killed ${pid}`) }
  catch { console.log(`skip ${pid} (already gone)`) }
}
