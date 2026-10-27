require('dotenv').config();
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_FILE || './data.db');
db.pragma('foreign_keys = ON'); db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, avatar TEXT, role TEXT NOT NULL DEFAULT 'member', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', deadline TEXT, owner_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS members(project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN('owner','admin','member','viewer')), PRIMARY KEY(project_id,user_id));
CREATE TABLE IF NOT EXISTS columns(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT DEFAULT '', priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN('low','medium','high','critical')), due_date TEXT, position INTEGER NOT NULL DEFAULT 0, assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL, labels TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, project_id INTEGER, task_id INTEGER, kind TEXT DEFAULT 'info', text TEXT NOT NULL, read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id), text TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_tasks_col ON tasks(column_id,position);
`);
db.createProject = (owner, name, description = '', deadline = null) => db.transaction(() => {
  const id = db.prepare('INSERT INTO projects(name,description,deadline,owner_id) VALUES(?,?,?,?)').run(name, description, deadline, owner).lastInsertRowid;
  db.prepare("INSERT INTO members VALUES(?,?, 'owner')").run(id, owner);
  ['To Do', 'In Progress', 'In Review', 'Completed'].forEach((c, i) => db.prepare('INSERT INTO columns(project_id,name,position) VALUES(?,?,?)').run(id, c, i));
  return id;
})();
module.exports = db;
