const mysql = require('mysql2/promise');

async function testCredentials() {
    const attempts = [
        { user: 'root', password: '' },
        { user: 'root', password: 'sathish142008' },
        { user: 'root', password: 'root' },
        { user: 'lms_user', password: 'sathish142008' },
        { user: 'lms_user', password: 'lms_pass_change_me' },
        { user: 'lms_user', password: '' },
        { user: 'lms_user', password: 'password' }
    ];

    for (const cred of attempts) {
        try {
            console.log(`Trying user='${cred.user}' password='${cred.password}'...`);
            const conn = await mysql.createConnection({
                host: 'localhost',
                ...cred
            });
            console.log(`>>> CONNECTED SUCCESSFULLY as user '${cred.user}' with password '${cred.password}'!`);
            
            const [dbs] = await conn.query('SHOW DATABASES');
            console.log('Databases:', dbs.map(d => d.Database).join(', '));
            
            await conn.end();
            return cred;
        } catch (err) {
            console.log(`  Failed: ${err.message}`);
        }
    }
    console.log('All attempted credentials failed.');
}

testCredentials();
