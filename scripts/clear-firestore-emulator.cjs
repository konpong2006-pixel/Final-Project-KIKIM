// `emulators:exec` leaves the Firestore emulator running when the script it
// wraps exits non-zero, and the next run then dies with "port taken" rather
// than the failure that actually needs fixing. Clearing first makes a failed
// test rerunnable without a manual hunt for the stray java process.
const {execFileSync} = require('node:child_process');

const isWindows = process.platform === 'win32';
const marker = 'cloud-firestore-emulator';

function run(file, args) {
  try {
    return execFileSync(file, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
  } catch {
    return '';
  }
}

const pids = isWindows
  ? run('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { $_.ProcessId }`,
  ]).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  : run('pgrep', ['-f', marker]).split('\n').map((line) => line.trim()).filter(Boolean);

for (const pid of pids) {
  if (isWindows) run('taskkill', ['/PID', pid, '/F']);
  else run('kill', ['-9', pid]);
  console.log(`Stopped stray Firestore emulator ${pid}`);
}

if (pids.length) {
  // The port is released a moment after the process dies.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);
}
