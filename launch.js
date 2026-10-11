const { spawn } = require('child_process');
const p = spawn('node', ['index.js'], {
    detached: true,
    stdio: 'ignore'
});
p.unref();
process.exit(0);
