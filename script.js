const API_URL = 'http://localhost:5000/api';

let state = {
  projects: [],
  tasks: [],
  members: [],
  user: null,
};

// selected color state used by project modal
let selectedColor = '#667eea';

/***** API Functions *****/

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('projectflow_token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) {
    headers['x-auth-token'] = token;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ msg: 'An unknown error occurred' }));
    throw new Error(errorData.msg || response.statusText);
  }
  
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return null;
  }

  return response.json();
}


/***** Auth Functions *****/
function switchAuthForm(){
  byId('loginForm').classList.toggle('active');
  byId('signupForm').classList.toggle('active');
}

async function handleLogin(e){
  e.preventDefault();
  const email = byId('loginEmail').value.trim();
  const password = byId('loginPassword').value;

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('projectflow_token', data.token);
    await loadInitialData();
    byId('authScreen').classList.add('hidden');
  } catch (error) {
    showToast(`Login failed: ${error.message}`, 'error');
  }
}

async function handleSignup(e){
  e.preventDefault();
  const name = byId('signupName').value.trim();
  const email = byId('signupEmail').value.trim();
  const password = byId('signupPassword').value;
  const confirm = byId('signupConfirm').value;

  if(password !== confirm){
    showToast('Passwords do not match', 'error');
    return;
  }

  try {
    const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
    });
    localStorage.setItem('projectflow_token', data.token);
    await loadInitialData();
    byId('authScreen').classList.add('hidden');
  } catch (error) {
    showToast(`Signup failed: ${error.message}`, 'error');
  }
}

function logout(){
  if(confirm('Are you sure you want to logout?')){
    localStorage.removeItem('projectflow_token');
    state = { projects: [], tasks: [], members:[], user: null };
    byId('authScreen').classList.remove('hidden');
    document.querySelectorAll('.page').forEach(p=> p.style.display = 'none');
  }
}

async function checkAuth(){
  const token = localStorage.getItem('projectflow_token');
  if (token) {
    try {
        await loadInitialData();
        byId('authScreen').classList.add('hidden');
    } catch(e) {
        console.error("Auth check failed", e);
        logout(); // Token might be invalid
    }
  }
}


/***** Data Functions *****/
function uid(prefix='id'){
  return prefix + '_' + Math.random().toString(36).slice(2,9);
}

function nowDate(){
  return new Date().toISOString().split('T')[0];
}

async function loadInitialData() {
    try {
        const projects = await apiFetch('/projects');
        state.projects = projects;

        let allTasks = [];
        for (const project of projects) {
            const projectTasks = await apiFetch(`/tasks/project/${project._id}`);
            allTasks = allTasks.concat(projectTasks);
        }
        state.tasks = allTasks;

        // Fetch all users to act as members
        // NOTE: In a real app, you'd likely have a more sophisticated way
        // of managing users and team members.
        // This requires a new endpoint to get all users. 
        // For now, we'll extract members from projects.
        const memberSet = new Set();
        projects.forEach(p => {
            p.members.forEach(m => memberSet.add(JSON.stringify(m)));
        });
        state.members = Array.from(memberSet).map(m => JSON.parse(m));
        
        // A /api/auth/me would be better to get current user's name
        // Decoding JWT on client-side is not ideal but works for now to get user ID
        const token = localStorage.getItem('projectflow_token');
        if(token) {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const user = state.members.find(m => m._id === payload.user.id);
            if(user) {
              state.user = { name: user.name, email: user.email };
              updateUserDisplay();
            }
        }
        
        initializeApp();
    } catch (error) {
        console.error('Failed to load data:', error);
        showToast('Failed to load data. Please try logging in again.', 'error');
        logout();
    }
}


function updateUserDisplay(){
  if(state.user){
    byId('userDisplayName').innerText = state.user.name;
    const avatar = byId('userDisplayAvatar');
    if(avatar){
      const name = encodeURIComponent(state.user.name);
      avatar.src = `https://ui-avatars.com/api/?name=${name}&background=667eea&color=fff&size=40`;
    }
  }
}

/***** UI Utils *****/
function byId(id){ return document.getElementById(id); }

function switchTab(e){
  const tab = e?.target?.closest('.nav-item')?.dataset?.tab || e;
  if(!tab) return;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.tab===tab));
  ['dashboard','projects','tasks','team','settings'].forEach(id=>{const el=byId(id); if(el) el.style.display = id===tab ? 'block' : 'none'});
  renderAll();
}

function openModal(id){ byId(id).classList.add('show'); document.body.style.overflow='hidden'; }
function closeModal(id){ byId(id).classList.remove('show'); document.body.style.overflow=''; }

document.addEventListener('click', (e)=>{
  if(e.target.classList.contains('modal')){ closeModal(e.target.id); }
});

/***** Project Modal *****/
function openProjectModal(editId){
  resetProjectForm();
  populateColorPicker();
  populateProjectMembers(editId);
  if(editId){
    const p = state.projects.find(x=>x._id===editId);
    if(p){
      byId('projectId').value = p._id;
      byId('projectName').value = p.name;
      byId('projectDescription').value = p.description;
      byId('projectStatus').value = p.status;
      byId('projectDueDate').value = p.due ? p.due.split('T')[0] : '';
      selectColor(p.color);
      byId('projectModalTitle').innerText='Edit Project';
    }
  } else { byId('projectModalTitle').innerText='New Project'; }
  openModal('projectModal');
}
function closeProjectModal(){ closeModal('projectModal'); }

function resetProjectForm(){ ['projectId','projectName','projectDescription','projectDueDate'].forEach(id=>{ if(byId(id)) byId(id).value=''; }); selectedColor = null; }

async function saveProject(e){
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const id = byId('projectId').value;
    const name = byId('projectName').value.trim();
    if(!name) throw new Error('Project name required');
    const due = byId('projectDueDate').value;
    if(!due) throw new Error('Due date required');

    const members = Array.from(byId('projectMembers').selectedOptions).map(o => o.value);
    const projectData = {
      name,
      description:byId('projectDescription').value.trim(),
      status:byId('projectStatus').value,
      due:due,
      color:selectedColor||'#667eea',
      members
    };

    if(id){
      const updatedProject = await apiFetch(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(projectData)
      });
      const i = state.projects.findIndex(p=>p._id===id);
      if(i>-1) state.projects[i] = updatedProject;
    } else {
      const newProject = await apiFetch('/projects', {
        method: 'POST',
        body: JSON.stringify(projectData)
      });
      state.projects.unshift(newProject);
    }
    populateProjectOptions();
    closeProjectModal();
    renderAll();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Project';
  }
}

/***** Task Modal *****/
function openTaskModal(editId){
  resetTaskForm();
  populateProjectOptions();
  populateMemberOptions();
  if(editId){
    const t = state.tasks.find(x=>x._id===editId);
    if(t){
      byId('taskId').value=t._id;
      byId('taskTitle').value=t.title;
      byId('taskDescription').value=t.description;
      byId('taskPriority').value=t.priority;
      byId('taskStatus').value=t.status;
      byId('taskProject').value=t.project || '';
      byId('taskAssignee').value=t.assignedTo || '';
      byId('taskDueDate').value=t.due ? t.due.split('T')[0] : '';
      byId('taskModalTitle').innerText='Edit Task';
    }
  } else byId('taskModalTitle').innerText='New Task';
  openModal('taskModal');
}
function closeTaskModal(){ closeModal('taskModal'); }

function resetTaskForm(){ ['taskId','taskTitle','taskDescription','taskDueDate'].forEach(id=>{ if(byId(id)) byId(id).value=''; }); if(byId('taskPriority')) byId('taskPriority').value='low'; if(byId('taskStatus')) byId('taskStatus').value='todo'; }

async function saveTask(e){
  e.preventDefault();
  const id = byId('taskId').value;
  const title = byId('taskTitle').value.trim();
  if(!title) return showToast('Task title required', 'error');
  const due = byId('taskDueDate').value;
  if(!due) return showToast('Due date required', 'error');

  const taskData = {
    title,
    description:byId('taskDescription').value,
    priority:byId('taskPriority').value,
    status:byId('taskStatus').value,
    project:byId('taskProject').value||null,
    assignedTo:byId('taskAssignee').value||null,
    due:due
  }; 
  
  try {
    if(id){ 
      const updatedTask = await apiFetch(`/tasks/${id}`, {
        method: 'PUT',
        body: JSON.stringify(taskData)
      });
      const i = state.tasks.findIndex(t=>t._id===id); 
      if(i>-1) state.tasks[i] = updatedTask; 
    } else { 
      const newTask = await apiFetch('/tasks', {
        method: 'POST',
        body: JSON.stringify(taskData)
      });
      state.tasks.unshift(newTask); 
    } 
    closeTaskModal();
    renderAll();
  } catch (error) {
    showToast(`Error saving task: ${error.message}`, 'error');
  }
}

/***** Team Modal *****/
function openTeamModal(editId){
  resetTeamForm();
  if(editId){
    const m = state.members.find(x=>x._id===editId);
    if(m){
      byId('memberId').value = m._id;
      byId('memberName').value = m.name;
      byId('memberEmail').value = m.email;
      byId('memberRole').value = m.role || '';
      byId('teamModalTitle').innerText = 'Edit Member';
    }
  } else {
    byId('teamModalTitle').innerText = 'Add Member';
  }
  openModal('teamModal');
}
function closeTeamModal(){ closeModal('teamModal'); }
function resetTeamForm(){ ['memberId','memberName','memberEmail','memberRole'].forEach(id=>{ if(byId(id)) byId(id).value=''; }); }
function saveMember(e){
  e.preventDefault();
  const id = byId('memberId').value;
  const name = byId('memberName').value.trim();
  const email = byId('memberEmail').value.trim();
  const role = byId('memberRole').value.trim();
  if(!name || !email) return showToast('Name and email required', 'error');
  if(id){
    const m = state.members.find(x=>x._id===id);
    if(m){
      m.name = name;
      m.email = email;
      m.role = role;
      showToast('Member updated', 'success');
    }
  } else {
    const newMember = { _id: uid(), name, email, role };
    state.members.push(newMember);
    showToast('Member added', 'success');
  }
  renderTeam();
  closeTeamModal();
}
function deleteMember(id){
  if(confirm('Delete this member? This may affect projects and tasks.')){
    state.members = state.members.filter(m=>m._id!==id);
    // Also remove from projects and tasks
    state.projects.forEach(p => p.members = p.members.filter(m => m._id !== id));
    state.tasks.forEach(t => { if(t.assignedTo && t.assignedTo._id === id) t.assignedTo = null; });
    renderAll();
    showToast('Member deleted', 'success');
  }
}

// Populate project <select> elements
function populateProjectOptions(selectedId = null, elementId = 'taskProject') {
  const sel = byId(elementId);
  if (!sel) return;
  sel.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '(none)';
  sel.appendChild(empty);
  (state.projects || []).forEach(p => {
    const o = document.createElement('option');
    o.value = p._id;
    o.textContent = p.name || 'Untitled';
    if (selectedId && p._id === selectedId) o.selected = true;
    sel.appendChild(o);
  });
}

// Populate member <select> elements
function populateMemberOptions(selectedId = null, elementId = 'taskAssignee') {
  const sel = byId(elementId);
  if (!sel) return;
  sel.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'Unassigned';
  sel.appendChild(empty);
  (state.members || []).forEach(m => {
    const o = document.createElement('option');
    o.value = m._id;
    o.textContent = m.name || m.email || 'Member';
    if (selectedId && m._id === selectedId) o.selected = true;
    sel.appendChild(o);
  });
}

function populateProjectMembers(editId){
  const sel = byId('projectMembers');
  if (!sel) return;
  sel.innerHTML = '';
  (state.members || []).forEach(m => {
    const o = document.createElement('option');
    o.value = m._id;
    o.textContent = m.name || m.email || 'Member';
    if(editId){
      const p = state.projects.find(x=>x._id===editId);
      if(p && p.members.some(mem => mem._id === m._id)) o.selected = true;
    }
    sel.appendChild(o);
  });
}


// Build the project color picker (small swatches)
function populateColorPicker() {
  const container = byId('projectColorPicker');
  if (!container) return;
  const colors = ['#667eea', '#5e4db0', '#36b37e', '#f5cd47', '#ae2a19', '#60a5fa', '#f97316'];
  container.innerHTML = '';
  colors.forEach(c => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-option';
    btn.dataset.color = c;
    btn.style.background = c;
    btn.addEventListener('click', () => selectColor(c));
    if (selectedColor && selectedColor.toLowerCase() === c.toLowerCase()) btn.classList.add('selected');
    container.appendChild(btn);
  });
}

// Select a color from the picker
function selectColor(color) {
  selectedColor = color;
  document.querySelectorAll('.color-option').forEach(b => {
    b.classList.toggle('selected', b.dataset.color === color);
  });
}

/***** Renderers *****/
function renderAll(){
  renderStats();
  renderDashboardProjects();
  renderDashboardTasks();
  renderProjects();
  renderTasks();
  renderTeam();
  renderSettings();
}

function renderStats(){ 
  const projects = state.projects.length; 
  const tasks = state.tasks.length; 
  const members = state.members.length; 
  const completed = state.tasks.filter(t=>t.status==='completed').length; 
  const statsGrid = byId('statsGrid'); 
  if(!statsGrid) return; 
  statsGrid.innerHTML = ''; 
  const templates = [{number:projects,label:'Projects'}, {number:tasks,label:'Tasks'}, {number:members,label:'Members'}, {number:completed,label:'Completed'}]; 
  templates.forEach(s=>{ const card=document.createElement('div');card.className='stat-card';card.innerHTML=`<div class="stat-number">${s.number}</div><div class="stat-label">${s.label}</div>`; statsGrid.appendChild(card);});
}

function renderDashboardProjects(){ 
  const container = byId('dashboardProjects'); 
  if(!container) return; 
  container.innerHTML=''; 
  const list = state.projects.slice(0,6); 
  if(list.length === 0){
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding=60px 20px;color:var(--text-tertiary)"><i class="fa-solid fa-inbox" style="font-size:48px;margin-bottom:16px;display:block;opacity:0.5"></i><p>No projects yet. Create your first project!</p></div>';
    return;
  }
  list.forEach(p=>{ 
    const el=document.createElement('div'); 
    el.className='project-card'; 
    el.innerHTML = `
      <div class="project-name">${escapeHtml(p.name)}</div>
      <div class="project-desc">${escapeHtml(p.description||'')}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${projectProgress(p._id)}%"></div></div>
      <div class="project-footer">
        <div class="project-meta">
          <span class="badge ${statusClass(p.status)}">${toTitle(p.status)}</span>
          <span style="margin-left:auto">${projectProgress(p._id)}%</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:14px">
        <button class="btn btn-ghost" onclick="openProjectModal('${p._id}')" type="button"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-ghost" onclick="deleteProject('${p._id}')" type="button"><i class="fa-solid fa-trash"></i></button>
      </div>
    `; 
    container.appendChild(el); 
  }); 
}

function renderProjects(){ 
  const container = byId('projectsGrid'); 
  if(!container) return; 
  container.innerHTML=''; 
  const list = state.projects.slice(); 
  if(list.length === 0){
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding=60px 20px;color:var(--text-tertiary)"><i class="fa-solid fa-inbox" style="font-size:48px;margin-bottom:16px;display:block;opacity:0.5"></i><p>No projects yet. Create your first project!</p></div>';
    return;
  }
  list.forEach(p=>{ 
    const el=document.createElement('div'); 
    el.className='project-card'; 
    el.innerHTML=`
      <div class="project-name">${escapeHtml(p.name)}</div>
      <div class="project-desc">${escapeHtml(p.description||'')}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${projectProgress(p._id)}%"></div></div>
      <div class="project-footer">
        <div class="project-meta">
          <span class="badge ${statusClass(p.status)}">${toTitle(p.status)}</span>
          <span style="margin-left:auto">${projectProgress(p._id)}%</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:14px">
        <button class="btn btn-ghost" onclick="openProjectModal('${p._id}')" type="button"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-ghost" onclick="deleteProject('${p._id}')" type="button"><i class="fa-solid fa-trash"></i></button>
      </div>
    `; 
    container.appendChild(el); 
  }); 
}

function renderDashboardTasks(){ 
  const container = byId('dashboardTasks'); 
  if(!container) return; 
  container.innerHTML=''; 
  const list = state.tasks.slice(0,8); 
  if(list.length === 0){
    container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-tertiary)"><i class="fa-solid fa-inbox" style="font-size:48px;margin-bottom:16px;display:block;opacity:0.5"></i><p>No tasks yet. Create your first task!</p></div>';
    return;
  }
  list.forEach(t=>{ 
    const el=document.createElement('div'); 
    el.className='task-item'; 
    el.innerHTML=`
      <input type="checkbox" class="task-checkbox" ${t.status==='completed'?'checked':''} onchange="toggleTaskStatus('${t._id}', this.checked)">
      <div class="task-content">
        <div class="task-title">${escapeHtml(t.title)}</div>
        <div class="task-meta">${memberName(t.assignedTo?._id)} • Due ${t.due ? new Date(t.due).toLocaleDateString() : '—'}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="badge ${priorityClass(t.priority)}">${t.priority}</div>
        <div class="badge ${statusClass(t.status)}" style="margin-top:4px">${toTitle(t.status)}</div>
      </div>
      <div class="task-actions">
        <button class="btn btn-ghost" onclick="openTaskModal('${t._id}')" type="button"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-ghost" onclick="deleteTask('${t._id}')" type="button"><i class="fa-solid fa-trash"></i></button>
      </div>
    `; 
    container.appendChild(el); 
  }); 
}

function renderTasks(){ 
  const container = byId('tasksGrid'); 
  if(!container) return; 
  container.innerHTML=''; 
  const list = state.tasks.slice(); 
  if(list.length === 0){
    container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-tertiary)"><i class="fa-solid fa-inbox" style="font-size:48px;margin-bottom:16px;display:block;opacity:0.5"></i><p>No tasks yet. Create your first task!</p></div>';
    return;
  }
  list.forEach(t=>{ 
    const el=document.createElement('div'); 
    el.className='task-item'; 
    const project = state.projects.find(p=>p._id===t.project); 
    el.innerHTML=`
      <input type="checkbox" class="task-checkbox" ${t.status==='completed'?'checked':''} onchange="toggleTaskStatus('${t._id}', this.checked)">
      <div class="task-content">
        <div class="task-title">${escapeHtml(t.title)} ${project?'<span style="color:var(--text-secondary)">• '+escapeHtml(project.name)+'</span>':''}</div>
        <div class="task-meta">${escapeHtml(t.description||'No description')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px">Due ${t.due ? new Date(t.due).toLocaleDateString() : '—'}</div>
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <div class="badge ${priorityClass(t.priority)}">${t.priority}</div>
          <div class="badge ${statusClass(t.status)}">${toTitle(t.status)}</div>
        </div>
      </div>
      <div class="task-actions">
        <button class="btn btn-ghost" onclick="openTaskModal('${t._id}')" type="button"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-ghost" onclick="deleteTask('${t._id}')" type="button"><i class="fa-solid fa-trash"></i></button>
      </div>
    `; 
    container.appendChild(el); 
  }); 
}

function renderTeam(){
  const container = byId('teamGrid');
  if(!container) return;
  container.innerHTML='';
  if(state.members.length === 0){
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding=60px 20px;color:var(--text-tertiary)"><i class="fa-solid fa-users" style="font-size:48px;margin-bottom:16px;display:block;opacity:0.5"></i><p>No team members yet.</p></div>';
    return;
  }
  state.members.forEach(m=>{
    const el=document.createElement('div');
    el.className='team-card';
    el.innerHTML=`
      <div class="team-avatar">${initials(m.name)}</div>
      <div class="team-name">${escapeHtml(m.name)}</div>
      <div class="team-role">${escapeHtml(m.role || 'Member')}</div>
      <div class="team-email">${escapeHtml(m.email)}</div>
      <div style="display:flex;gap:6px;margin-top:14px">
        <button class="btn btn-ghost" onclick="openTeamModal('${m._id}')" type="button"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-ghost" onclick="deleteMember('${m._id}')" type="button"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    container.appendChild(el);
  });
}

function renderSettings(){
  if(state.user){
    byId('settingsName').innerText = state.user.name || '';
    byId('settingsEmail').innerText = state.user.email || '';
  }
}

/***** Helpers *****/
function toTitle(s){ if(!s) return ''; return s.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ') }
function statusClass(s){ return 'status-'+(s || 'todo') }
function priorityClass(p){ return 'priority-'+(p||'low') }
function memberName(id){ const m = state.members.find(x=>x._id===id); return m ? m.name : 'Unassigned' }
function initials(name){ return (name||'').split(' ').map(x=>x[0]||'').join('').slice(0,2).toUpperCase() }
function escapeHtml(s){ if(s===undefined || s===null) return ''; return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;') }
function projectProgress(projectId){ const tasks = state.tasks.filter(t=>t.project===projectId); if(tasks.length===0) return 0; const done = tasks.filter(t=>t.status==='completed').length; return Math.round((done/tasks.length)*100); }

async function toggleTaskStatus(id, isChecked) {
    const status = isChecked ? 'completed' : 'todo';
    try {
        const updatedTask = await apiFetch(`/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
        const i = state.tasks.findIndex(t => t._id === id);
        if (i > -1) state.tasks[i] = updatedTask;
        renderAll();
    } catch (error) {
        showToast(`Error updating task: ${error.message}`, 'error');
    }
}


/***** CRUD *****/
async function deleteProject(id){
  if(!confirm('Delete this project? This will also delete all associated tasks.')) return;
  try {
    await apiFetch(`/projects/${id}`, { method: 'DELETE' });
    state.projects = state.projects.filter(p=>p._id!==id);
    state.tasks = state.tasks.filter(t=>t.project !== id);
    populateProjectOptions();
    renderAll();
  } catch (error) {
    showToast(`Error deleting project: ${error.message}`, 'error');
  }
}
async function deleteTask(id){
  if(!confirm('Delete this task?')) return;
  try {
    await apiFetch(`/tasks/${id}`, { method: 'DELETE' });
    state.tasks = state.tasks.filter(t=>t._id!==id);
    renderAll();
  } catch (error) {
    showToast(`Error deleting task: ${error.message}`, 'error');
  }
}
function deleteMember(id){
    showToast("This functionality is not supported in this version.", 'info');
}

/***** Export/Import *****/
function openExport(){ openModal('exportModal'); }
function closeExport(){ closeModal('exportModal'); }
function openImport(){ openModal('importModal'); }
function closeImport(){ closeModal('importModal'); }

function exportData(){
  const data = { projects: state.projects, tasks: state.tasks, members: state.members };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'projectflow_backup.json';
  a.click();
  URL.revokeObjectURL(url);
  closeExport();
  showToast('Data exported successfully', 'success');
}

function importData(){
  const file = byId('importFile').files[0];
  if(!file) return showToast('Please select a file', 'error');
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      state.projects = data.projects || [];
      state.tasks = data.tasks || [];
      state.members = data.members || [];
      renderAll();
      closeImport();
      showToast('Data imported successfully', 'success');
    } catch (error) {
      showToast('Invalid file format', 'error');
    }
  };
  reader.readAsText(file);
}

/***** Toast Notifications *****/
function showToast(message, type = 'info'){
  const container = byId('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

/***** Settings *****/
function loadSettings(){
  const savedTheme = localStorage.getItem('theme') || 'light';
  const savedFont = localStorage.getItem('fontFamily') || 'Arial, sans-serif';
  const savedSize = localStorage.getItem('fontSize') || '16px';
  byId('themeSelect').value = savedTheme;
  byId('fontSelect').value = savedFont;
  byId('fontSizeSelect').value = savedSize;
  applyTheme(savedTheme);
  applyAppearance();
}

function applyTheme(theme){
  document.body.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('theme', theme);
}

function applyAppearance(){
  const font = byId('fontSelect').value;
  const size = byId('fontSizeSelect').value;
  document.body.style.fontFamily = font;
  document.body.style.fontSize = size;
  localStorage.setItem('fontFamily', font);
  localStorage.setItem('fontSize', size);
}

/***** App Init *****/
function initializeApp(){
  loadSettings();
  renderAll();
  populateColorPicker();
  populateProjectOptions();
  populateMemberOptions();
  switchTab('dashboard');

  // Settings event listeners
  byId('themeSelect').addEventListener('change', () => {
    const theme = byId('themeSelect').value;
    applyTheme(theme);
  });
  byId('fontSelect').addEventListener('change', applyAppearance);
  byId('fontSizeSelect').addEventListener('change', applyAppearance);
}

// On load
window.addEventListener('load', checkAuth);
