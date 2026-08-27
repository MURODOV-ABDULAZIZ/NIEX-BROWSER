const { spawn } = require('child_process');

const proc = spawn('SafeNet Browser.exe', [
  '--disable-gpu',
  '--no-sandbox',
  '--disable-software-rasterizer',
  '--disable-gpu-sandbox'
], {
  cwd: 'D:\\Narimon Ecosystem\\BRAUZER\\BRAUZER\\dist\\win-unpacked',
  stdio: ['pipe', 'pipe', 'pipe']
});

proc.stdout.on('data', d => console.log('STDOUT:', d.toString()));
proc.stderr.on('data', d => console.log('STDERR:', d.toString()));
proc.on('close', c => console.log('EXIT:', c));

setTimeout(() => proc.kill(), 30000);