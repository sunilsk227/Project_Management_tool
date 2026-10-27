require('dotenv').config();
const fs = require('fs'), path = require('path'), http = require('http');
const express = require('express'), cors = require('cors'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), { Server } = require('socket.io');
const db = require('./db');
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) throw new Error('Set JWT_SECRET (16+ chars) in .env');
const ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const app = express(); app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false })); app.use(cors({ origin: ORIGIN })); app.use(express.json({ limit: '100kb' }));
const srv = http.createServer(app), io = new Server(srv, { cors: { origin: ORIGIN } });

const bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
const wrap = f => (q, s, n) => Promise.resolve().then(() => f(q, s, n)).catch(n);
const str = (v, min, max, f) => { if (typeof v !== 'string') throw bad(`${f} is required`); v = v.trim(); if (v.length < min || v.length > max) throw bad(`${f} must be ${min}-${max} characters`); return v; };
const date = v => { if (v == null || v === '') return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Invalid date'); return v; };
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });
const pub = u => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar, role: u.role });
const get = (sql, ...a) => db.prepare(sql).get(...a), all = (sql, ...a) => db.prepare(sql).all(...a), run = (sql, ...a) => db.prepare(sql).run(...a);
const page = q => ({ limit: Math.min(+q.limit || 20, 100), offset: Math.max(+q.offset || 0, 0) });

const auth = (q, s, n) => {
  try { q.user = get('SELECT * FROM users WHERE id=?', jwt.verify((q.headers.authorization || '').slice(7), SECRET).id); if (!q.user) throw 0; n(); }
  catch { s.status(401).json({ error: 'Unauthorized' }); }
};
const need = (pid, uid, level) => {
  const r = get('SELECT role FROM members WHERE project_id=? AND user_id=?', pid, uid)?.role;
  if (!r) throw bad('Not found', 404);
  if (level === 'write' && r === 'viewer') throw bad('Read-only access', 403);
  if (level === 'admin' && !['owner', 'admin'].includes(r)) throw bad('Admin access required', 403);
  return r;
};
const notify = (uid, text, pid, tid, kind = 'info') => {
  const id = run('INSERT INTO notifications(user_id,project_id,task_id,kind,text) VALUES(?,?,?,?,?)', uid, pid, tid, kind, text).lastInsertRowid;
  io.to('u:' + uid).emit('notification', get('SELECT * FROM notifications WHERE id=?', id));
};
const log = (pid, uid, text) => run('INSERT INTO activity(project_id,user_id,text) VALUES(?,?,?)', pid, uid, text);
const changed = pid => io.to('p:' + pid).emit('changed', { projectId: pid });

const authLimit = rateLimit({ windowMs: 15 * 60e3, limit: 30, standardHeaders: true, legacyHeaders: false });
app.post('/api/auth/register', authLimit, wrap((q, s) => {
  const name = str(q.body.name, 2, 60, 'Name'), email = str(q.body.email, 5, 120, 'Email').toLowerCase(), pw = q.body.password;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Invalid email');
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 100) throw bad('Password must be 8-100 characters');
  if (get('SELECT 1 FROM users WHERE email=?', email)) throw bad('Email already registered', 409);
  const id = run('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)', name, email, bcrypt.hashSync(pw, 12)).lastInsertRowid;
  const u = get('SELECT * FROM users WHERE id=?', id); s.status(201).json({ token: sign(u), user: pub(u) });
}));
app.post('/api/auth/login', authLimit, wrap((q, s) => {
  const u = get('SELECT * FROM users WHERE email=?', String(q.body.email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(String(q.body.password || ''), u.password_hash)) throw bad('Invalid email or password', 401);
  s.json({ token: sign(u), user: pub(u) });
}));
app.get('/api/me', auth, (q, s) => s.json(pub(q.user)));
app.patch('/api/me', auth, wrap((q, s) => {
  const name = str(q.body.name, 2, 60, 'Name'); const avatar = q.body.avatar ? str(q.body.avatar, 8, 300, 'Avatar') : null;
  if (avatar && !/^https:\/\//.test(avatar)) throw bad('Avatar must be an https URL');
  run('UPDATE users SET name=?,avatar=? WHERE id=?', name, avatar, q.user.id); s.json(pub(get('SELECT * FROM users WHERE id=?', q.user.id)));
}));

app.get('/api/dashboard', auth, (q, s) => {
  const me = q.user.id, base = `FROM tasks t JOIN columns c ON c.id=t.column_id WHERE t.assignee_id=?`;
  const n = x => get(`SELECT COUNT(*) n ${base} ${x}`, me).n;
  s.json({
    projects: get('SELECT COUNT(*) n FROM members WHERE user_id=?', me).n, assigned: n(''),
    inProgress: n("AND c.name='In Progress'"), completed: n("AND c.name='Completed'"),
    overdue: n("AND c.name!='Completed' AND t.due_date<date('now')"),
    upcoming: all(`SELECT t.id,t.title,t.due_date,t.project_id ${base} AND c.name!='Completed' AND t.due_date>=date('now') ORDER BY t.due_date LIMIT 5`, me),
    activity: all(`SELECT a.text,a.created_at,u.name FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE a.project_id IN(SELECT project_id FROM members WHERE user_id=?) ORDER BY a.id DESC LIMIT 10`, me),
  });
});

const progressSql = `SELECT p.*,m.role,(SELECT COUNT(*) FROM tasks WHERE project_id=p.id) total,(SELECT COUNT(*) FROM tasks t JOIN columns c ON c.id=t.column_id WHERE t.project_id=p.id AND c.name='Completed') done FROM projects p JOIN members m ON m.project_id=p.id AND m.user_id=?`;
app.get('/api/projects', auth, (q, s) => { const { limit, offset } = page(q.query);
  s.json(all(`${progressSql} WHERE p.name LIKE ? ORDER BY p.id DESC LIMIT ? OFFSET ?`, q.user.id, `%${String(q.query.q || '').slice(0, 50)}%`, limit, offset)); });
app.post('/api/projects', auth, wrap((q, s) => {
  const id = db.createProject(q.user.id, str(q.body.name, 2, 80, 'Name'), String(q.body.description || '').slice(0, 1000), date(q.body.deadline));
  log(id, q.user.id, 'created the project'); io.in('u:' + q.user.id).socketsJoin('p:' + id); s.status(201).json(get(`${progressSql} WHERE p.id=?`, q.user.id, id));
}));
app.get('/api/projects/:id', auth, wrap((q, s) => {
  const id = +q.params.id, role = need(id, q.user.id);
  s.json({ role, project: get('SELECT * FROM projects WHERE id=?', id),
    members: all('SELECT u.id,u.name,u.email,u.avatar,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?', id),
    columns: all('SELECT * FROM columns WHERE project_id=? ORDER BY position', id),
    tasks: all('SELECT * FROM tasks WHERE project_id=? ORDER BY position,id', id) });
}));
app.patch('/api/projects/:id', auth, wrap((q, s) => {
  const id = +q.params.id; need(id, q.user.id, 'admin');
  run('UPDATE projects SET name=?,description=?,deadline=? WHERE id=?', str(q.body.name, 2, 80, 'Name'), String(q.body.description || '').slice(0, 1000), date(q.body.deadline), id);
  changed(id); s.json({ ok: true });
}));
app.delete('/api/projects/:id', auth, wrap((q, s) => {
  const id = +q.params.id; if (need(id, q.user.id) !== 'owner') throw bad('Only the owner can delete', 403);
  changed(id); run('DELETE FROM projects WHERE id=?', id); s.json({ ok: true });
}));
app.post('/api/projects/:id/members', auth, wrap((q, s) => {
  const id = +q.params.id; need(id, q.user.id, 'admin');
  const role = q.body.role; if (!['admin', 'member', 'viewer'].includes(role)) throw bad('Invalid role');
  const u = get('SELECT * FROM users WHERE email=?', String(q.body.email || '').toLowerCase().trim()); if (!u) throw bad('No user with that email', 404);
  run("INSERT INTO members VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role WHERE members.role!='owner'", id, u.id, role);
  io.in('u:' + u.id).socketsJoin('p:' + id); notify(u.id, `You were added to "${get('SELECT name FROM projects WHERE id=?', id).name}"`, id, null);
  log(id, q.user.id, `added ${u.name} as ${role}`); changed(id); s.status(201).json({ ok: true });
}));

app.post('/api/projects/:id/columns', auth, wrap((q, s) => {
  const id = +q.params.id; need(id, q.user.id, 'admin');
  const pos = get('SELECT COALESCE(MAX(position)+1,0) n FROM columns WHERE project_id=?', id).n;
  run('INSERT INTO columns(project_id,name,position) VALUES(?,?,?)', id, str(q.body.name, 1, 40, 'Column name'), pos); changed(id); s.status(201).json({ ok: true });
}));
app.delete('/api/columns/:id', auth, wrap((q, s) => {
  const c = get('SELECT * FROM columns WHERE id=?', +q.params.id); if (!c) throw bad('Not found', 404); need(c.project_id, q.user.id, 'admin');
  run('DELETE FROM columns WHERE id=?', c.id); log(c.project_id, q.user.id, `deleted column "${c.name}"`); changed(c.project_id); s.json({ ok: true });
}));

const taskOr404 = (id, uid, level) => { const t = get('SELECT * FROM tasks WHERE id=?', id); if (!t) throw bad('Not found', 404); need(t.project_id, uid, level); return t; };
const checkAssignee = (pid, a) => { if (a != null && !get('SELECT 1 FROM members WHERE project_id=? AND user_id=?', pid, a)) throw bad('Assignee must be a project member'); };
const PRI = ['low', 'medium', 'high', 'critical'];
app.post('/api/projects/:id/tasks', auth, wrap((q, s) => {
  const pid = +q.params.id; need(pid, q.user.id, 'write'); const b = q.body;
  const col = get('SELECT * FROM columns WHERE id=? AND project_id=?', +b.column_id, pid); if (!col) throw bad('Invalid column');
  const pr = b.priority || 'medium'; if (!PRI.includes(pr)) throw bad('Invalid priority');
  const title = str(b.title, 1, 150, 'Title'), a = b.assignee_id ? +b.assignee_id : null; checkAssignee(pid, a);
  const pos = get('SELECT COALESCE(MAX(position)+1,0) n FROM tasks WHERE column_id=?', col.id).n;
  const id = run('INSERT INTO tasks(project_id,column_id,title,description,priority,due_date,position,assignee_id,labels) VALUES(?,?,?,?,?,?,?,?,?)',
    pid, col.id, title, String(b.description || '').slice(0, 5000), pr, date(b.due_date), pos, a, String(b.labels || '').slice(0, 100)).lastInsertRowid;
  log(pid, q.user.id, `created task "${title}"`);
  if (a && a !== q.user.id) notify(a, `${q.user.name} assigned you "${title}"`, pid, id, 'assign');
  changed(pid); s.status(201).json(get('SELECT * FROM tasks WHERE id=?', id));
}));
app.patch('/api/tasks/:id', auth, wrap((q, s) => {
  const t = taskOr404(+q.params.id, q.user.id, 'write'), b = q.body, set = {};
  if ('title' in b) set.title = str(b.title, 1, 150, 'Title');
  if ('description' in b) set.description = String(b.description || '').slice(0, 5000);
  if ('priority' in b) { if (!PRI.includes(b.priority)) throw bad('Invalid priority'); set.priority = b.priority; }
  if ('due_date' in b) set.due_date = date(b.due_date);
  if ('labels' in b) set.labels = String(b.labels || '').slice(0, 100);
  if ('assignee_id' in b) { set.assignee_id = b.assignee_id ? +b.assignee_id : null; checkAssignee(t.project_id, set.assignee_id); }
  let moved = null;
  if ('column_id' in b) {
    moved = get('SELECT * FROM columns WHERE id=? AND project_id=?', +b.column_id, t.project_id); if (!moved) throw bad('Invalid column');
    const pos = Math.max(0, parseInt(b.position) || 0);
    run('UPDATE tasks SET position=position+1 WHERE column_id=? AND position>=? AND id!=?', moved.id, pos, t.id); set.column_id = moved.id; set.position = pos;
  }
  const keys = Object.keys(set); if (!keys.length) throw bad('Nothing to update');
  run(`UPDATE tasks SET ${keys.map(k => k + '=?').join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=?`, ...keys.map(k => set[k]), t.id);
  log(t.project_id, q.user.id, moved && moved.id !== t.column_id ? `moved "${t.title}" to ${moved.name}` : `updated "${t.title}"`);
  if (set.assignee_id && set.assignee_id !== t.assignee_id && set.assignee_id !== q.user.id) notify(set.assignee_id, `${q.user.name} assigned you "${t.title}"`, t.project_id, t.id, 'assign');
  changed(t.project_id); s.json(get('SELECT * FROM tasks WHERE id=?', t.id));
}));
app.delete('/api/tasks/:id', auth, wrap((q, s) => {
  const t = taskOr404(+q.params.id, q.user.id, 'write'); run('DELETE FROM tasks WHERE id=?', t.id);
  log(t.project_id, q.user.id, `deleted task "${t.title}"`); changed(t.project_id); s.json({ ok: true });
}));

app.get('/api/tasks/:id/comments', auth, wrap((q, s) => {
  const t = taskOr404(+q.params.id, q.user.id); const { limit, offset } = page(q.query);
  s.json(all('SELECT c.*,u.name author FROM comments c JOIN users u ON u.id=c.user_id WHERE task_id=? ORDER BY c.id LIMIT ? OFFSET ?', t.id, limit, offset));
}));
app.post('/api/tasks/:id/comments', auth, wrap((q, s) => {
  const t = taskOr404(+q.params.id, q.user.id, 'write'), body = str(q.body.body, 1, 2000, 'Comment');
  run('INSERT INTO comments(task_id,user_id,body) VALUES(?,?,?)', t.id, q.user.id, body);
  if (t.assignee_id && t.assignee_id !== q.user.id) notify(t.assignee_id, `${q.user.name} commented on "${t.title}"`, t.project_id, t.id, 'comment');
  changed(t.project_id); s.status(201).json({ ok: true });
}));
app.delete('/api/comments/:id', auth, wrap((q, s) => {
  const c = get('SELECT c.*,t.project_id pid FROM comments c JOIN tasks t ON t.id=c.task_id WHERE c.id=?', +q.params.id); if (!c) throw bad('Not found', 404);
  const r = need(c.pid, q.user.id); if (c.user_id !== q.user.id && !['owner', 'admin'].includes(r)) throw bad('Not allowed', 403);
  run('DELETE FROM comments WHERE id=?', c.id); changed(c.pid); s.json({ ok: true });
}));

app.get('/api/notifications', auth, (q, s) => { const { limit, offset } = page(q.query);
  s.json(all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?', q.user.id, limit, offset)); });
app.post('/api/notifications/read', auth, (q, s) => { run('UPDATE notifications SET read=1 WHERE user_id=?', q.user.id); s.json({ ok: true }); });

const dist = path.join(__dirname, '../client/dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get(/^\/(?!api|socket\.io).*/, (q, s) => s.sendFile(path.join(dist, 'index.html'))); }
app.use('/api', (q, s) => s.status(404).json({ error: 'Not found' }));
app.use((e, q, s, n) => { if (!e.status) console.error(e); s.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); });

// Sockets: rooms only for projects the user belongs to; events carry ids, clients refetch via authorized REST.
io.use((s, n) => { try { s.uid = jwt.verify(s.handshake.auth.token, SECRET).id; n(); } catch { n(new Error('unauthorized')); } });
io.on('connection', s => { s.join('u:' + s.uid); all('SELECT project_id p FROM members WHERE user_id=?', s.uid).forEach(r => s.join('p:' + r.p)); });

setInterval(() => all(`SELECT t.* FROM tasks t JOIN columns c ON c.id=t.column_id WHERE c.name!='Completed' AND t.assignee_id IS NOT NULL AND t.due_date BETWEEN date('now') AND date('now','+1 day')
  AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.task_id=t.id AND n.kind='deadline' AND date(n.created_at)=date('now'))`)
  .forEach(t => notify(t.assignee_id, `"${t.title}" is due ${t.due_date}`, t.project_id, t.id, 'deadline')), 36e5);

srv.listen(process.env.PORT || 4000, () => console.log('API on :' + (process.env.PORT || 4000)));
