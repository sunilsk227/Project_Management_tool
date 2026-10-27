import { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { LayoutDashboard, Plus, Bell, Moon, Sun, LogOut, Trash2, Menu, X } from 'lucide-react';

const api = async (path, o = {}) => {
  const t = localStorage.token;
  const r = await fetch('/api' + path, { ...o, headers: { 'Content-Type': 'application/json', ...(t && { Authorization: 'Bearer ' + t }) }, body: o.body && JSON.stringify(o.body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
};
const ini = n => (n || '?').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();
const Av = ({ u }) => u?.avatar ? <img className="av" src={u.avatar} alt={u.name} /> : <span className="av" title={u?.name}>{ini(u?.name)}</span>;
const today = () => new Date().toISOString().slice(0, 10);

export default function App() {
  const [user, setUser] = useState(null), [ready, setReady] = useState(false), [dark, setDark] = useState(localStorage.dark === '1');
  const [collapsed, setCollapsed] = useState(window.innerWidth < 760), [view, setView] = useState('dash'), [projects, setProjects] = useState([]);
  const [q, setQ] = useState(''), [notes, setNotes] = useState([]), [open, setOpen] = useState(false), [toasts, setToasts] = useState([]), [tick, setTick] = useState(0);
  const toast = useCallback((m, e) => { const id = Math.random(); setToasts(t => [...t, { id, m, e }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500); }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.dark = dark ? '1' : '0'; }, [dark]);
  useEffect(() => { if (!localStorage.token) return setReady(true); api('/me').then(setUser).catch(() => localStorage.removeItem('token')).finally(() => setReady(true)); }, []);
  useEffect(() => { if (user) api('/projects?q=' + encodeURIComponent(q)).then(setProjects).catch(e => toast(e.message, 1)); }, [user, q, tick]);
  useEffect(() => {
    if (!user) return;
    api('/notifications').then(setNotes).catch(() => {});
    const s = io({ auth: { token: localStorage.token } });
    s.on('notification', n => { setNotes(x => [n, ...x]); toast(n.text); });
    s.on('changed', () => setTick(t => t + 1));
    return () => s.close();
  }, [user]);
  if (!ready) return <div className="spin" />;
  if (!user) return <Auth onAuth={(u, t) => { localStorage.token = t; setUser(u); }} />;
  const unread = notes.filter(n => !n.read).length;
  const logout = () => { localStorage.removeItem('token'); setUser(null); setView('dash'); };
  const newProject = async () => {
    const name = prompt('Project name'); if (!name) return;
    try { const p = await api('/projects', { method: 'POST', body: { name } }); setView(p.id); setTick(t => t + 1); toast('Project created'); } catch (e) { toast(e.message, 1); }
  };
  return (
    <div className={'app' + (collapsed ? ' c' : '')}>
      <aside aria-label="Sidebar">
        <div className="logo">Tidewell</div>
        <button className={'it' + (view === 'dash' ? ' on' : '')} onClick={() => setView('dash')}><LayoutDashboard size={16} />Dashboard</button>
        <div className="mu" style={{ marginTop: 10 }}>PROJECTS</div>
        {projects.map(p => <button key={p.id} className={'it' + (view === p.id ? ' on' : '')} onClick={() => setView(p.id)}>{p.name}</button>)}
        <button className="it" onClick={newProject}><Plus size={16} />New project</button>
      </aside>
      <div>
        <header>
          <button className="i" aria-label="Toggle sidebar" onClick={() => setCollapsed(!collapsed)}><Menu size={16} /></button>
          <input placeholder="Search projects…" aria-label="Search projects" value={q} onChange={e => setQ(e.target.value)} />
          <span className="sp" />
          <button className="i" aria-label="Toggle theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          <button className="i" aria-label="Notifications" onClick={() => { setOpen(!open); if (unread) api('/notifications/read', { method: 'POST' }).then(() => setNotes(n => n.map(x => ({ ...x, read: 1 })))); }}>
            <Bell size={16} />{unread > 0 && <span className="bdg">{unread}</span>}</button>
          <Av u={user} />
          <button className="i" aria-label="Log out" onClick={logout}><LogOut size={16} /></button>
        </header>
        {open && <div className="card drop">{notes.length ? notes.map(n => <div key={n.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--bd)' }}>{n.text}<div className="mu">{n.created_at}</div></div>) : <span className="mu">No notifications</span>}</div>}
        <main>{view === 'dash' ? <Dashboard tick={tick} projects={projects} open={setView} /> : <Board key={view} id={view} me={user} tick={tick} toast={toast} onGone={() => { setView('dash'); setTick(t => t + 1); }} />}</main>
      </div>
      <div className="toasts" role="status">{toasts.map(t => <div key={t.id} className={'toast' + (t.e ? ' e' : '')}>{t.m}</div>)}</div>
    </div>
  );
}

function Auth({ onAuth }) {
  const [reg, setReg] = useState(false), [f, setF] = useState({ name: '', email: '', password: '' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const d = await api('/auth/' + (reg ? 'register' : 'login'), { method: 'POST', body: f }); onAuth(d.user, d.token); } catch (x) { setErr(x.message); } setBusy(false);
  };
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return <div className="auth"><form className="card" onSubmit={submit}>
    <div className="logo">Tidewell</div><h2 style={{ margin: 0 }}>{reg ? 'Create account' : 'Welcome back'}</h2>
    {reg && <label>Name<input required minLength={2} value={f.name} onChange={set('name')} /></label>}
    <label>Email<input type="email" required value={f.email} onChange={set('email')} /></label>
    <label>Password<input type="password" required minLength={8} value={f.password} onChange={set('password')} /></label>
    {err && <div className="err" role="alert">{err}</div>}
    <button className="p" disabled={busy}>{busy ? 'Please wait…' : reg ? 'Register' : 'Log in'}</button>
    <button type="button" onClick={() => setReg(!reg)}>{reg ? 'I have an account' : 'Create an account'}</button>
  </form></div>;
}

function Dashboard({ tick, projects, open }) {
  const [d, setD] = useState(null);
  useEffect(() => { api('/dashboard').then(setD); }, [tick]);
  if (!d) return <div className="spin" />;
  const stats = [['Projects', d.projects], ['My tasks', d.assigned], ['In progress', d.inProgress], ['Completed', d.completed], ['Overdue', d.overdue]];
  return <>
    <div className="cards">{stats.map(([k, v]) => <div className="card" key={k}><span className="mu">{k}</span><b>{v}</b></div>)}</div>
    <div className="grid2">
      <div className="card"><h3>Project progress</h3>{projects.length ? projects.map(p => <div key={p.id}><a href="#" onClick={e => { e.preventDefault(); open(p.id); }}>{p.name}</a>
        <div className="bar"><i style={{ width: (p.total ? p.done / p.total * 100 : 0) + '%' }} /></div></div>) : <p className="mu">No projects yet. Create one from the sidebar.</p>}</div>
      <div className="card"><h3>Upcoming deadlines</h3>{d.upcoming.length ? d.upcoming.map(t => <div key={t.id}>{t.title} <span className="mu">· {t.due_date}</span></div>) : <p className="mu">Nothing due.</p>}</div>
      <div className="card"><h3>Recent activity</h3>{d.activity.length ? d.activity.map((a, i) => <div key={i}><b>{a.name}</b> {a.text}</div>) : <p className="mu">No activity yet.</p>}</div>
    </div></>;
}

function Board({ id, me, tick, toast, onGone }) {
  const [d, setD] = useState(null), [drag, setDrag] = useState(null), [over, setOver] = useState(null), [sel, setSel] = useState(null);
  const [flt, setFlt] = useState({ a: '', p: '', t: '' }), [inv, setInv] = useState({ email: '', role: 'member' });
  useEffect(() => { api('/projects/' + id).then(setD).catch(() => onGone()); }, [id, tick]);
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); } catch (e) { toast(e.message, 1); } };
  if (!d) return <div className="spin" />;
  const canW = d.role !== 'viewer', canA = ['owner', 'admin'].includes(d.role), by = Object.fromEntries(d.members.map(m => [m.id, m]));
  const vis = t => (!flt.a || String(t.assignee_id) === flt.a) && (!flt.p || t.priority === flt.p) && (!flt.t || t.title.toLowerCase().includes(flt.t.toLowerCase()));
  const drop = (col, idx) => { if (!drag) return; const tid = drag; setDrag(null); setOver(null); act(() => api('/tasks/' + tid, { method: 'PATCH', body: { column_id: col.id, position: idx } })); };
  return <>
    <div className="row" style={{ marginBottom: 12 }}>
      <div style={{ flex: 3 }}><h2 style={{ margin: 0 }}>{d.project.name}</h2><span className="mu">{d.project.description} {d.project.deadline && '· due ' + d.project.deadline} · you are {d.role}</span></div>
      <input placeholder="Filter tasks" aria-label="Filter tasks" value={flt.t} onChange={e => setFlt({ ...flt, t: e.target.value })} />
      <select aria-label="Assignee" value={flt.a} onChange={e => setFlt({ ...flt, a: e.target.value })}><option value="">All assignees</option>{d.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <select aria-label="Priority" value={flt.p} onChange={e => setFlt({ ...flt, p: e.target.value })}><option value="">All priorities</option>{['low', 'medium', 'high', 'critical'].map(p => <option key={p}>{p}</option>)}</select>
      {d.role === 'owner' && <button className="d" style={{ flex: 0 }} onClick={() => confirm('Delete this project and all its tasks?') && act(() => api('/projects/' + id, { method: 'DELETE' }).then(onGone), 'Project deleted')}><Trash2 size={14} />Delete</button>}
    </div>
    {canA && <form className="row" style={{ marginBottom: 12 }} onSubmit={e => { e.preventDefault(); act(() => api(`/projects/${id}/members`, { method: 'POST', body: inv }).then(() => setInv({ ...inv, email: '' })), 'Member added'); }}>
      <input type="email" required placeholder="Invite by email (user must be registered)" aria-label="Invite email" value={inv.email} onChange={e => setInv({ ...inv, email: e.target.value })} />
      <select aria-label="Role" value={inv.role} onChange={e => setInv({ ...inv, role: e.target.value })}>{['admin', 'member', 'viewer'].map(r => <option key={r}>{r}</option>)}</select><button style={{ flex: 0 }}>Invite</button></form>}
    <div className="board">
      {d.columns.map(c => { const ts = d.tasks.filter(t => t.column_id === c.id); return (
        <section key={c.id} className={'col' + (over === c.id ? ' over' : '')} onDragOver={e => { e.preventDefault(); setOver(c.id); }} onDrop={() => drop(c, ts.length)} aria-label={c.name}>
          <div className="row" style={{ flexWrap: 'nowrap' }}><b>{c.name} <span className="mu">{ts.length}</span></b>
            {canA && <button className="i d" style={{ flex: 0, minWidth: 0 }} aria-label={'Delete column ' + c.name} onClick={() => confirm(`Delete column "${c.name}" and its tasks?`) && act(() => api('/columns/' + c.id, { method: 'DELETE' }), 'Column deleted')}><X size={14} /></button>}</div>
          {ts.filter(vis).map(t => { const idx = ts.indexOf(t); return (
            <article key={t.id} className="task" draggable={canW} onDragStart={() => setDrag(t.id)} onDrop={e => { e.stopPropagation(); drop(c, idx); }} onClick={() => setSel(t)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setSel(t)}>
              <div>{t.title}</div>
              <div className="row" style={{ marginTop: 6, gap: 6 }}><span className={'tag ' + t.priority}>{t.priority}</span>{t.labels && <span className="tag">{t.labels}</span>}
                {t.due_date && <span className="tag" style={{ color: t.due_date < today() && c.name !== 'Completed' ? 'var(--dg)' : undefined }}>{t.due_date}</span>}
                <span style={{ flex: 0, marginLeft: 'auto' }}>{by[t.assignee_id] && <Av u={by[t.assignee_id]} />}</span></div>
            </article>); })}
          {canW && <button onClick={() => { const title = prompt('Task title'); if (title) act(() => api(`/projects/${id}/tasks`, { method: 'POST', body: { title, column_id: c.id } }), 'Task created'); }}><Plus size={14} />Add task</button>}
        </section>); })}
      {canA && <button onClick={() => { const name = prompt('Column name'); if (name) act(() => api(`/projects/${id}/columns`, { method: 'POST', body: { name } })); }}><Plus size={14} />Add column</button>}
    </div>
    {sel && <TaskModal t={d.tasks.find(x => x.id === sel.id) || sel} members={d.members} me={me} role={d.role} tick={tick} act={act} close={() => setSel(null)} />}
  </>;
}

function TaskModal({ t, members, me, role, tick, act, close }) {
  const [f, setF] = useState({ title: t.title, description: t.description || '', priority: t.priority, due_date: t.due_date || '', assignee_id: t.assignee_id || '', labels: t.labels || '' });
  const [cm, setCm] = useState([]), [txt, setTxt] = useState(''); const w = role !== 'viewer';
  const loadC = () => api(`/tasks/${t.id}/comments`).then(setCm);
  useEffect(() => { loadC(); }, [tick]);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return <div className="modal" onClick={close}><div className="box" role="dialog" aria-modal="true" aria-label="Task details" onClick={e => e.stopPropagation()}>
    <input aria-label="Title" disabled={!w} value={f.title} onChange={set('title')} />
    <textarea aria-label="Description" rows={3} disabled={!w} placeholder="Description" value={f.description} onChange={set('description')} />
    <div className="row">
      <select aria-label="Priority" disabled={!w} value={f.priority} onChange={set('priority')}>{['low', 'medium', 'high', 'critical'].map(p => <option key={p}>{p}</option>)}</select>
      <input type="date" aria-label="Due date" disabled={!w} value={f.due_date} onChange={set('due_date')} />
      <select aria-label="Assignee" disabled={!w} value={f.assignee_id} onChange={set('assignee_id')}><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <input aria-label="Label" placeholder="Label" disabled={!w} value={f.labels} onChange={set('labels')} />
    </div>
    <div className="row">{w && <button className="p" onClick={() => act(() => api('/tasks/' + t.id, { method: 'PATCH', body: { ...f, assignee_id: f.assignee_id || null, due_date: f.due_date || null } }).then(close), 'Task saved')}>Save</button>}
      {w && <button className="d" onClick={() => confirm('Delete this task?') && act(() => api('/tasks/' + t.id, { method: 'DELETE' }).then(close), 'Task deleted')}><Trash2 size={14} />Delete</button>}<button onClick={close}>Close</button></div>
    <div className="mu">Created {t.created_at} · updated {t.updated_at}</div>
    <h4 style={{ margin: 0 }}>Comments</h4>
    {cm.length ? cm.map(c => <div key={c.id} className="card"><b>{c.author}</b> <span className="mu">{c.created_at}</span>
      {(c.user_id === me.id || ['owner', 'admin'].includes(role)) && <button className="i d" aria-label="Delete comment" style={{ float: 'right' }} onClick={() => act(() => api('/comments/' + c.id, { method: 'DELETE' }).then(loadC))}><Trash2 size={13} /></button>}<div>{c.body}</div></div>) : <span className="mu">No comments yet.</span>}
    {w && <form className="row" onSubmit={e => { e.preventDefault(); act(() => api(`/tasks/${t.id}/comments`, { method: 'POST', body: { body: txt } }).then(() => { setTxt(''); loadC(); })); }}>
      <input aria-label="New comment" required placeholder="Write a comment…" value={txt} onChange={e => setTxt(e.target.value)} style={{ flex: 4 }} /><button className="p">Send</button></form>}
  </div></div>;
}
