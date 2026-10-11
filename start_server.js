const { spawn } = require('child_process');
const fs = require('fs');
const out = fs.openSync('/home/sathish/lls/server.log', 'a');
const err = fs.openSync('/home/sathish/lls/server.log', 'a');

const child = spawn('node', ['/home/sathish/lls/index.js'], {
  detached: true,
  stdio: [ 'ignore', out, err ]
});

child.unref();
console.log('SERVER_SPAWNED_PID:', child.pid);
process.exit(0);
