const bcrypt = require('bcryptjs'), db = require('./db');
if (db.prepare('SELECT 1 FROM users').get()) { console.log('Users exist; skipping seed.'); process.exit(0); }
const hash = bcrypt.hashSync('demo1234', 12);
const u = (n, e) => db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(n, e, hash).lastInsertRowid;
const alice = u('Alice Rao', 'alice@demo.local'), bob = u('Bob Chen', 'bob@demo.local');
const p = db.createProject(alice, 'Website Relaunch', 'Redesign and ship the marketing site', '2026-12-15');
db.prepare("INSERT INTO members VALUES(?,?, 'member')").run(p, bob);
const cols = db.prepare('SELECT id FROM columns WHERE project_id=? ORDER BY position').all(p);
[['Wireframes', 0, 'high', bob], ['Write copy', 0, 'medium', alice], ['Build homepage', 1, 'critical', bob], ['QA pass', 2, 'low', alice], ['Pick fonts', 3, 'low', alice]]
  .forEach(([t, c, pr, a], i) => db.prepare("INSERT INTO tasks(project_id,column_id,title,priority,position,assignee_id,due_date,labels) VALUES(?,?,?,?,?,?,date('now',?),?)")
    .run(p, cols[c].id, t, pr, i, a, `+${i + 1} days`, 'web'));
db.prepare('INSERT INTO comments(task_id,user_id,body) VALUES(1,?,?)').run(alice, 'Please share a first draft by Friday.');
db.prepare("INSERT INTO notifications(user_id,project_id,task_id,kind,text) VALUES(?,?,1,'assign','Alice Rao assigned you \"Wireframes\"')").run(bob, p);
db.prepare('INSERT INTO activity(project_id,user_id,text) VALUES(?,?,?)').run(p, alice, 'created the project');
console.log('Seeded. DEV ONLY logins: alice@demo.local / bob@demo.local, password demo1234');
