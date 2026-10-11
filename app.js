function showNotification(message, isError = false) {
  const notif = document.getElementById('notification');
  notif.textContent = message;
  notif.style.borderColor = isError ? 'var(--danger)' : 'var(--success)';
  notif.classList.add('show');
  setTimeout(() => {
    notif.classList.remove('show');
  }, 3000);
}

function toggleAuth() {
  document.getElementById('loginForm').classList.toggle('hidden');
  document.getElementById('registerForm').classList.toggle('hidden');
}

async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...options,
      body: options.body instanceof FormData ? options.body : (options.body ? JSON.stringify(options.body) : undefined)
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      throw new Error(`Server returned HTML (Did you forget to restart the Node server?)`);
    }
    if (!response.ok) {
      throw new Error(data.error || 'API Error');
    }
    return data;
  } catch (err) {
    showNotification(err.message, true);
    throw err;
  }
}

// ---------------------------------------------------------------
// Keep the chat composer visible when the on-screen keyboard opens.
// Some mobile browsers (iOS Safari, older Android) don't shrink the
// layout viewport when the keyboard shows — the input ends up hidden
// behind it. We track the visual viewport and resize the chat modal.
// ---------------------------------------------------------------
(function initChatKeyboardFix() {
  if (!window.visualViewport) return;
  const resizeForKeyboard = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const chatModal = document.getElementById('chatModal');
    if (chatModal && !chatModal.classList.contains('hidden')) {
      const content = chatModal.querySelector('.modal-content');
      if (content) {
        // visible height excludes keyboard
        content.style.maxHeight = (vv.height - 8) + 'px';
        content.style.height = 'auto';
      }
    }
  };
  window.visualViewport.addEventListener('resize', resizeForKeyboard);
  window.visualViewport.addEventListener('scroll', resizeForKeyboard);
})();

async function login() {
  const user = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  if (!user || !pass) return showNotification('Please fill all fields', true);
  
  try {
    const res = await apiCall('/api/login', { method: 'POST', body: { username: user, password: pass } });
    showNotification(res.message);
    checkSession();
  } catch (e) {}
}

async function register() {
  const user = document.getElementById('regUser').value;
  const pass = document.getElementById('regPass').value;
  if (!user || !pass) return showNotification('Please fill all fields', true);
  
  try {
    const res = await apiCall('/api/register', { method: 'POST', body: { username: user, password: pass } });
    showNotification(res.message);
    toggleAuth();
  } catch (e) {}
}

async function logout() {
  try {
    await apiCall('/api/logout', { method: 'POST' });
    stopUnreadPolling();
    document.getElementById('mainHeader').classList.add('hidden');
    document.getElementById('authSection').classList.remove('hidden');
    // Hide the mobile FAB on logout
    const fab = document.querySelector('.mobile-fab-nav');
    if (fab) { fab.style.display = 'none'; fab.innerHTML = ''; }
    ['adminSection', 'staffSection', 'studentSection'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
  } catch (e) {}
}

async function checkSession() {
  // Swap logos on mobile only
  swapMobileLogos();
  try {
    const res = await apiCall('/api/session');
    const role = res.user.role;
    
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('mainHeader').classList.remove('hidden');
    document.getElementById('userRoleBadge').textContent = role.toUpperCase();
    
    document.getElementById('adminSection').classList.add('hidden');
    document.getElementById('staffSection').classList.add('hidden');
    document.getElementById('studentSection').classList.add('hidden');
    
    if (role === 'admin') {
      document.getElementById('adminSection').classList.remove('hidden');
      loadAdminData();
    } else if (role === 'staff') {
      document.getElementById('staffSection').classList.remove('hidden');
      loadStaffData();
      startUnreadPolling();
        } else if (role === 'student') {
      document.getElementById('studentSection').classList.remove('hidden');
      loadStudentData();
      startUnreadPolling();
    }
    // Initialize role-aware mobile FAB navigation
    initMobileFab(role);
  } catch (e) {
    document.getElementById('authSection').classList.remove('hidden');
    document.getElementById('mainHeader').classList.add('hidden');
    // Hide FAB when logged out
    const fab = document.querySelector('.mobile-fab-nav');
    if (fab) { fab.style.display = 'none'; fab.innerHTML = ''; }
  }
}

// Admin Functions
async function createStaff() {
  const user = document.getElementById('staffUser').value;
  const pass = document.getElementById('staffPass').value;
  if (!user || !pass) return showNotification('Please fill all fields', true);
  try {
    const res = await apiCall('/api/admin/staff', { method: 'POST', body: { username: user, password: pass } });
    showNotification(res.message);
    document.getElementById('staffUser').value = '';
    document.getElementById('staffPass').value = '';
    loadAdminStaff();
  } catch(e) {}
}

async function createClass() {
  const name = document.getElementById('className').value;
  try {
    const res = await apiCall('/api/admin/classes', { method: 'POST', body: { name } });
    showNotification(res.message);
    document.getElementById('className').value = '';
  } catch(e) {}
}

let allClasses = [];
let currentAdminStudents = [];

async function loadAdminData() {
  try {
    const students = await apiCall('/api/admin/students');
    currentAdminStudents = students;
    renderAdminStudents(students);
  } catch(e) {}
  try {
    allClasses = await apiCall('/api/classes');
  } catch(e) {}
  loadAdminStaff();
  loadMentorAssignment();
}

function renderAdminStudents(students) {
  const tbody = document.querySelector('#adminStudentsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = students.map(s => `
    <tr>
      <td>${s.id}</td>
      <td>${s.username}</td>
      <td>${s.full_name || '-'}</td>
      <td>${s.class_name || '-'}</td>
      <td>
        ${s.is_approved ? '<span class="badge badge-success">Approved</span>' : '<span class="badge badge-warning">Pending</span>'}
      </td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${!s.is_approved ? `<button class="btn btn-secondary" onclick="approveStudent(${s.id})" style="padding:4px 8px; font-size:12px;">Approve</button>` : ''}
          <button class="btn btn-secondary" onclick="openAdminEditStudentModal(${s.id})" style="padding:4px 8px; font-size:12px;"> Edit</button>
        </div>
      </td>
    </tr>
  `).join('');
  
  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No students found</td></tr>';
  }
}

function filterAdminStudents() {
  const query = (document.getElementById('adminStudentSearch')?.value || '').toLowerCase();
  const filtered = currentAdminStudents.filter(s => 
    s.username.toLowerCase().includes(query) || 
    (s.full_name && s.full_name.toLowerCase().includes(query))
  );
  renderAdminStudents(filtered);
}

function openAdminEditStudentModal(studentId) {
  const s = currentAdminStudents.find(st => st.id == studentId);
  if (!s) return;
  document.getElementById('adminEditStudentId').value = s.id;
  document.getElementById('adminEditStudentDNumber').textContent = `D. No / Username: ${s.username}`;
  document.getElementById('adminEditStuName').value = s.full_name || '';
  document.getElementById('adminEditStuPhone').value = s.phone || '';
  document.getElementById('adminEditStuAddress').value = s.address || '';
  
  const select = document.getElementById('adminEditStuClass');
  select.innerHTML = '<option value="">Select Class</option>' + allClasses.map(c => 
    `<option value="${c.id}" ${s.class_id == c.id ? 'selected' : ''}>${c.name}</option>`
  ).join('');

  document.getElementById('adminEditStudentModal').classList.remove('hidden');
}

function closeAdminEditStudentModal() {
  document.getElementById('adminEditStudentModal').classList.add('hidden');
}

async function saveStudentDetailsByAdmin() {
  const student_id = document.getElementById('adminEditStudentId').value;
  const full_name = document.getElementById('adminEditStuName').value;
  const class_id = document.getElementById('adminEditStuClass').value;
  const phone = document.getElementById('adminEditStuPhone').value;
  const address = document.getElementById('adminEditStuAddress').value;

  if (!full_name || !class_id) {
    return showNotification('Full Name and Class are required', true);
  }

  try {
    const res = await apiCall('/api/admin/student/update-details', {
      method: 'POST',
      body: { student_id, full_name, class_id, phone, address }
    });
    showNotification(res.message);
    closeAdminEditStudentModal();
    loadAdminStudents();
  } catch(e) {
    showNotification(e.message || 'Failed to update student profile', true);
  }
}

let currentAdminStaff = [];

async function loadAdminStaff() {
  try {
    const staff = await apiCall('/api/admin/staff');
    currentAdminStaff = staff;
    renderAdminStaff(staff);
  } catch(e) {}
}

function renderAdminStaff(staff) {
  const tbody = document.querySelector('#adminStaffTable tbody');
  if (!tbody) return;
  tbody.innerHTML = staff.length ? staff.map(s => `
    <tr>
      <td>${s.id}</td>
      <td><strong>${s.username}</strong></td>
      <td>${s.full_name || '-'}</td>
      <td>${s.staff_id || '-'}</td>
      <td>${s.age || '-'}</td>
      <td>${s.aadhaar || '-'}</td>
      <td>${s.phone || '-'}</td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary" onclick="openAdminEditStaffModal(${s.id})" style="padding:4px 8px; font-size:12px;"> Edit</button>
          <button class="btn btn-danger" onclick="deleteStaff(${s.id}, '${s.username}')" style="padding:4px 8px; font-size:12px;">Delete</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="8" style="text-align:center; color: var(--text-muted);">No staff accounts yet</td></tr>';
}

function openAdminEditStaffModal(staffUserId) {
  const s = currentAdminStaff.find(st => st.id == staffUserId);
  if (!s) return;
  document.getElementById('adminEditStaffUserId').value = s.id;
  document.getElementById('adminEditStaffUsername').textContent = `Username: ${s.username}`;
  document.getElementById('adminEditStaffName').value = s.full_name || '';
  document.getElementById('adminEditStaffIdCode').value = s.staff_id || '';
  document.getElementById('adminEditStaffAge').value = s.age || '';
  document.getElementById('adminEditStaffAadhaar').value = s.aadhaar || '';
  document.getElementById('adminEditStaffPhone').value = s.phone || '';

  document.getElementById('adminEditStaffModal').classList.remove('hidden');
}

function closeAdminEditStaffModal() {
  document.getElementById('adminEditStaffModal').classList.add('hidden');
}

async function saveStaffDetailsByAdmin() {
  const staff_user_id = document.getElementById('adminEditStaffUserId').value;
  const full_name = document.getElementById('adminEditStaffName').value;
  const staff_id = document.getElementById('adminEditStaffIdCode').value;
  const age = document.getElementById('adminEditStaffAge').value;
  const aadhaar = document.getElementById('adminEditStaffAadhaar').value;
  const phone = document.getElementById('adminEditStaffPhone').value;

  try {
    const res = await apiCall('/api/admin/staff/update-details', {
      method: 'POST',
      body: { staff_user_id, full_name, staff_id, age, aadhaar, phone }
    });
    showNotification(res.message);
    closeAdminEditStaffModal();
    loadAdminStaff();
  } catch(e) {
    showNotification(e.message || 'Failed to update staff profile', true);
  }
}

async function deleteStaff(id, username) {
  if (!confirm(`Delete staff account "${username}"? This will also remove their uploaded materials and forms.`)) return;
  try {
    const res = await apiCall(`/api/admin/staff/${id}`, { method: 'DELETE' });
    showNotification(res.message);
    loadAdminStaff();
  } catch(e) {}
}

async function approveStudent(id) {
  try {
    await apiCall(`/api/admin/approve-student/${id}`, { method: 'POST' });
    showNotification('Student approved!');
    loadAdminData();
  } catch(e) {}
}

// Staff Functions
async function loadClasses(selectId) {
  try {
    const classes = await apiCall('/api/classes');
    const select = document.getElementById(selectId);
    select.innerHTML = '<option value="">Select a class</option>' + classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } catch(e) {}
}

async function loadStaffMaterials() {
  try {
    const materials = await apiCall('/api/staff/materials');
    const list = document.getElementById('staffMaterialsList');
    list.innerHTML = materials.length ? materials.map(m => `
      <li style="margin-bottom: 0.5rem; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px;">
        <div>
          <strong>${m.title}</strong>
          <div style="font-size:0.8rem; color:var(--text-muted)">Class: ${m.class_name || '-'}</div>
        </div>
        <div style="display:flex; gap:0.5rem;">
          <a href="${m.file_url}" target="_blank" class="btn btn-secondary">👁️ View</a>
          <button class="btn" style="background-color: var(--danger);" onclick="deleteMaterial(${m.id})">Delete</button>
        </div>
      </li>
    `).join('') : '<p style="color:var(--text-muted)">No materials uploaded yet.</p>';
  } catch(e) {}
}

async function deleteMaterial(id) {
  if (!confirm('Are you sure you want to delete this material?')) return;
  try {
    const res = await apiCall(`/api/staff/material/${id}`, { method: 'DELETE' });
    showNotification(res.message);
    loadStaffMaterials();
  } catch(e) {}
}

let currentEnrolledStudents = [];

async function loadStaffData() {
  loadClasses('matClass');
  loadClasses('attendanceClass');
  loadClassesWithAll('formClass');
  loadClasses('assignClass');
  loadClasses('quizClass');
  loadClassesWithAll('courseClass');
  populateDateSelects('dueDay', 'dueMonth', 'dueYear');
  loadStaffWeekCourses();
  loadStaffInbox();
  loadStaffLeaves();
  loadStaffAssignments();
  loadStaffQuizzes();
  loadEnrolledStaff();
  loadStaffProfile();
  
  showStaffFeature('materials', document.querySelector('.staff-nav-btn'));
  
  // Set today's date in local time
  const today = new Date();
  const localDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  document.getElementById('attendanceDate').value = localDate;
  
  // Predict day order (Monday=A, Tuesday=B, etc.)
  const dayOrders = ['A', 'A', 'B', 'C', 'D', 'E', 'F'];
  const predictedOrder = dayOrders[today.getDay()];
  const orderBtn = document.querySelector(`.day-btn[onclick*="'${predictedOrder}'"]`);
  if (orderBtn) {
    selectDayOrder(orderBtn, predictedOrder);
  }
  
  loadStaffMaterials();
  loadStaffForms();
  try {
    const students = await apiCall('/api/staff/students');
    currentEnrolledStudents = students;
    renderEnrolledStudents(students);
  } catch(e) {}
}

function renderEnrolledStudents(students) {
  const tbody = document.querySelector('#staffStudentsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = students.map(s => `
    <tr>
      <td>
        <a href="#" onclick="showStudentModal(${s.id}); return false;" style="color: var(--primary); font-weight: 600; text-decoration: none; padding: 0.5rem 0; display: inline-block;">
          ${s.username}
        </a>
      </td>
      <td>
        <button onclick="openChatWithStudent(${s.id}, '${(s.full_name || s.username).replace(/'/g, "\\'")}', '${(s.phone || '').replace(/'/g, "\\'")}')" class="msg-icon-btn" title="Open Chat">💬</button>
      </td>
    </tr>
  `).join('');
  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color: var(--text-muted);">No students found</td></tr>';
  }
}

function filterStudents() {
  const query = (document.getElementById('studentSearch')?.value || '').toLowerCase();
  const filtered = currentEnrolledStudents.filter(s => 
    s.username.toLowerCase().includes(query) || 
    (s.full_name && s.full_name.toLowerCase().includes(query))
  );
  renderEnrolledStudents(filtered);
}

function showStudentModal(id) {
  const s = currentEnrolledStudents.find(student => student.id === id);
  if (!s) return;
  document.getElementById('modalDNumber').textContent = 'D Number: ' + s.username;
  document.getElementById('modalName').textContent = s.full_name || '-';
  document.getElementById('modalClass').textContent = s.class_name || '-';
  document.getElementById('modalPhone').textContent = s.phone || '-';
  document.getElementById('modalAddress').textContent = s.address || '-';
  
  // Store selected student info for LMS messaging
  document.getElementById('modalSelectedStudentId').value = s.id;
  document.getElementById('modalSelectedStudentName').value = s.full_name || s.username;
  
  // Always show both buttons in modal
  document.getElementById('modalLmsMsgBtn').style.display = 'inline-flex';
  
  // Show WhatsApp button if phone is available
  const waBtn = document.getElementById('modalWhatsAppBtn');
  if (s.phone) {
    let phone = s.phone.replace(/[\s\-\+\(\)]/g, '');
    if (!phone.startsWith('91') && phone.length === 10) {
      phone = '91' + phone;
    }
    waBtn.href = 'https://wa.me/' + phone;
    waBtn.style.display = 'inline-flex';
  } else {
    waBtn.style.display = 'none';
  }
  
  document.getElementById('studentModal').classList.remove('hidden');
}

function closeStudentModal() {
  document.getElementById('studentModal').classList.add('hidden');
}

// =====================
// Chat Interface Functions (Works for Both Staff & Student)
// =====================

// Determine the role of the current user
function getMyRole() {
  const badge = document.getElementById('userRoleBadge');
  return badge ? badge.textContent.toLowerCase() : 'student';
}

// Open full chat screen with a contact
function openChatWithContact(contactId, contactName, phone) {
  closeStudentModal();
  
  document.getElementById('chatContactName').textContent = contactName || 'Contact';
  document.getElementById('chatContactSubtitle').textContent = 'Chatting...';
  
  // WhatsApp button
  const waBtn = document.getElementById('chatWhatsAppBtn');
  if (phone) {
    let cleanPhone = phone.replace(/[\s\-\+\(\)]/g, '');
    if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
      cleanPhone = '91' + cleanPhone;
    }
    waBtn.href = 'https://wa.me/' + cleanPhone;
    waBtn.style.display = 'flex';
  } else {
    waBtn.style.display = 'none';
  }
  
  // Store contact ID
  document.getElementById('chatInput').dataset.contactId = contactId;
  document.getElementById('chatInput').dataset.contactName = contactName || 'Contact';
  
  document.getElementById('chatMessages').innerHTML = '<div class="chat-loading">Loading messages...</div>';
  document.getElementById('chatModal').classList.remove('hidden');
  
  loadChatMessages(contactId);
}

function closeChatModal() {
  document.getElementById('chatModal').classList.add('hidden');
  document.getElementById('chatInput').value = '';
  document.getElementById('chatInput').dataset.contactId = '';
  document.getElementById('chatFileInput').value = '';
  document.getElementById('chatFileName').style.display = 'none';
}

// For staff: open chat with student (called from enrolled list, inbox, or modal)
function openChatWithStudent(studentId, studentName, phone) {
  window.location.href = '/chat.html?studentId=' + studentId + '&studentName=' + encodeURIComponent(studentName) + '&phone=' + encodeURIComponent(phone || '');
}

function openChatWithStaff(staffId, staffName) {
  window.location.href = '/chat.html?staffId=' + staffId + '&staffName=' + encodeURIComponent(staffName);
}

// Open chat from student detail modal
function openStaffChatFromModal() {
  const studentId = document.getElementById('modalSelectedStudentId').value;
  const studentName = document.getElementById('modalSelectedStudentName').value;
  const s = currentEnrolledStudents.find(st => st.id == studentId);
  const phone = s ? (s.phone || '') : '';
  openChatWithStudent(Number(studentId), studentName, phone);
}

// Load chat messages - auto-detects role to choose correct API endpoint
async function loadChatMessages(contactId) {
  const role = getMyRole();
  const apiEndpoint = role === 'staff' ? `/api/staff/chat/${contactId}` : `/api/student/chat/${contactId}`;
  
  try {
    const data = await apiCall(apiEndpoint);
    const messagesDiv = document.getElementById('chatMessages');
    
    if (!data.messages || data.messages.length === 0) {
      messagesDiv.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px 0;">No messages yet. Start the conversation!</div>';
      // Still mark as read to clear badge
      await apiCall('/api/messages/mark-read', { method: 'POST', body: { sender_id: contactId } });
      updateUnreadCounts();
      return;
    }
    
    let html = '';
    let lastDate = '';
    
    // The contact's ID is stored in dataset.contactId
    const contactIdFromDataset = Number(document.getElementById('chatInput').dataset.contactId);
    
    data.messages.forEach(m => {
      const msgDate = new Date(m.created_at).toLocaleDateString();
      if (msgDate !== lastDate) {
        html += `<div class="chat-date-divider">${msgDate}</div>`;
        lastDate = msgDate;
      }
      
      // If sender_id == contactId, then it's from them (received). Otherwise it's from us (sent).
      const isReceived = m.sender_id === contactIdFromDataset;
      const msgClass = isReceived ? 'received' : 'sent';
      const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      let content = '';
      if (m.message_text) {
        content += `<div>${m.message_text}</div>`;
      }
      if (m.media_url) {
        if (m.media_type === 'image') {
          content += `<img src="${m.media_url}" class="chat-message-image" onclick="window.open('${m.media_url}', '_blank')">`;
        } else {
          content += `<a href="${m.media_url}" target="_blank" class="chat-message-file"> View Attachment</a>`;
        }
      }
      
      html += `
        <div class="chat-message ${msgClass}">
          ${content}
          <div class="chat-message-time">${time}</div>
        </div>
      `;
    });
    
    messagesDiv.innerHTML = html;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    // Mark messages from this sender as read
    await apiCall('/api/messages/mark-read', { method: 'POST', body: { sender_id: contactId } });
    
    // Update badges after marking as read
    updateUnreadCounts();
  } catch (e) {
    document.getElementById('chatMessages').innerHTML = '<div style="text-align:center;color:var(--danger);padding:40px 0;">Failed to load messages.</div>';
  }
}

// Send message from chat - auto-detects role to choose correct API
async function sendChatMessage() {
  const contactId = document.getElementById('chatInput').dataset.contactId;
  const message = document.getElementById('chatInput').value.trim();
  const fileInput = document.getElementById('chatFileInput');
  const file = fileInput.files[0];
  
  if (!contactId) return;
  if (!message && !file) return;
  
  const role = getMyRole();
  // Staff sends to student, student sends to staff
  const apiEndpoint = role === 'staff' ? '/api/staff/send-message' : '/api/student/send-message';
  const idField = role === 'staff' ? 'student_id' : 'staff_id';
  
  const fd = new FormData();
  fd.append(idField, contactId);
  fd.append('message', message || '');
  if (file) {
    fd.append('messageFile', file);
  }
  
  try {
    document.getElementById('chatInput').disabled = true;
    await apiCall(apiEndpoint, { method: 'POST', body: fd });
    
    document.getElementById('chatInput').value = '';
    document.getElementById('chatFileInput').value = '';
    document.getElementById('chatFileName').style.display = 'none';
    
    await loadChatMessages(contactId);
  } catch (e) {}
  finally {
    document.getElementById('chatInput').disabled = false;
    document.getElementById('chatInput').focus();
  }
}

function chatFileName() {
  const fileInput = document.getElementById('chatFileInput');
  const fileNameSpan = document.getElementById('chatFileName');
  if (fileInput.files.length > 0) {
    fileNameSpan.textContent = fileInput.files[0].name;
    fileNameSpan.style.display = 'inline';
  } else {
    fileNameSpan.style.display = 'none';
  }
}

async function uploadMaterial() {
  const title = document.getElementById('matTitle').value;
  const classId = document.getElementById('matClass').value;
  const file = document.getElementById('matFile').files[0];
  
  if (!title || !classId || !file) return showNotification('Please fill all fields', true);
  
  const fd = new FormData();
  fd.append('title', title);
  fd.append('class_id', classId);
  fd.append('materialFile', file);
  
  try {
    const res = await apiCall('/api/staff/material', { method: 'POST', body: fd });
    showNotification(res.message);
    document.getElementById('matTitle').value = '';
    document.getElementById('matFile').value = '';
    loadStaffMaterials();
  } catch(e) {}
}

async function createForm() {
  const title = document.getElementById('formTitle').value;
  const link = document.getElementById('formLink').value;
  const class_id = document.getElementById('formClass').value || null;
  if (!title || !link) return showNotification('Please fill all fields', true);
  try {
    const res = await apiCall('/api/staff/form', { method: 'POST', body: { title, link, class_id } });
    showNotification(res.message);
    document.getElementById('formTitle').value = '';
    document.getElementById('formLink').value = '';
    document.getElementById('formClass').value = '';
    loadStaffForms();
  } catch(e) {}
}

async function loadStaffForms() {
  try {
    const forms = await apiCall('/api/staff/forms');
    const list = document.getElementById('staffFormsList');
    list.innerHTML = forms.length ? forms.map(f => `
      <li style="margin-bottom: 0.5rem; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px;">
        <div>
          <strong>${f.title}</strong>
          <div style="font-size:0.8rem; color:var(--text-muted)">
            ${f.class_name ? 'Class: ' + f.class_name : 'All Classes'}
            &nbsp;·&nbsp; Shared by <strong style="color: var(--text-main);">${f.staff_name}</strong>
          </div>
        </div>
        <div style="display:flex; gap:0.5rem;">
          <a href="${f.link}" target="_blank" class="btn btn-secondary">Open</a>
          <button class="btn btn-danger" onclick="deleteForm(${f.id})">Delete</button>
        </div>
      </li>
    `).join('') : '<p style="color:var(--text-muted)">No forms shared yet.</p>';
  } catch(e) {}
}

async function deleteForm(id) {
  if (!confirm('Delete this form?')) return;
  try {
    const res = await apiCall(`/api/staff/form/${id}`, { method: 'DELETE' });
    showNotification(res.message);
    loadStaffForms();
  } catch(e) {}
}

async function loadClassesWithAll(selectId) {
  try {
    const classes = await apiCall('/api/classes');
    const select = document.getElementById(selectId);
    select.innerHTML = '<option value="">All Classes</option>' + classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } catch(e) {}
}

let currentAttendanceList = [];
let currentDayOrder = 'A';

function selectDayOrder(btn, order) {
  currentDayOrder = order;
  // Remove active class from all day buttons
  const btns = document.querySelectorAll('.day-btn');
  btns.forEach(b => b.classList.remove('active'));
  // Add active class to clicked button
  btn.classList.add('active');
  
  // Optionally reload attendance if day order matters for fetching students
  // loadAttendanceStudents();
}

async function loadAttendanceStudents() {
  const classId = document.getElementById('attendanceClass').value;
  const date = document.getElementById('attendanceDate').value;
  
  if (!classId || !date) {
    document.getElementById('attendanceListContainer').classList.add('hidden');
    return;
  }
  
  try {
    const students = await apiCall(`/api/staff/attendance-list?class_id=${classId}&date=${date}`);
    currentAttendanceList = students;
    
    const tbody = document.querySelector('#attendanceTable tbody');
    const allRecorded = students.length > 0 && students.every(s => s.status != null);
    const viewedKey = `${ATT_VIEWED_PREFIX}_${classId}_${date}`;

    if (allRecorded) {
      // ---------- RESULT-ONLY MODE ----------
      // Attendance was already given for this date: show read-only
      // professional status badges instead of editable toggles.
      tbody.innerHTML = students.map(s => {
        const viewed = isViewed(viewedKey, s.id);
        const isPresent = s.status === 'Present';
        const badgeBg = isPresent
          ? (viewed ? 'rgba(16,185,129,0.16)' : 'rgba(16,185,129,0.24)')
          : (viewed ? 'rgba(239,68,68,0.16)' : 'rgba(239,68,68,0.24)');
        const badgeColor = isPresent ? '#059669' : '#dc2626';
        const borderC = isPresent ? 'rgba(16,185,129,0.45)' : 'rgba(239,68,68,0.45)';
        const icon = isPresent ? '✓' : '✕';
        return `
        <tr style="cursor:pointer;${viewed ? 'opacity:0.86;' : ''}" onclick="markAttViewed('${viewedKey}', ${s.id})">
          <td class="att-name-cell">
            <div class="att-name">${s.name}</div>
            ${s.name !== s.username ? `<div class="att-dno">D.No: ${s.username}</div>` : ''}
          </td>
          <td class="att-toggle-cell">
            <span style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:9999px;font-size:13px;font-weight:700;background:${badgeBg};color:${badgeColor};border:1px solid ${borderC};">
              ${icon} ${s.status}${viewed ? ' · Viewed' : ''}
            </span>
          </td>
        </tr>`;
      }).join('');
    } else {
      // ---------- MARKING MODE ----------
      // Attendance not yet given for this date: show toggles.
      tbody.innerHTML = students.map(s => `
        <tr>
          <td class="att-name-cell">
            <div class="att-name">${s.name}</div>
            ${s.name !== s.username ? `<div class="att-dno">D.No: ${s.username}</div>` : ''}
          </td>
          <td class="att-toggle-cell">
            <label class="attendance-toggle">
              <input type="checkbox" id="att_${s.id}" ${s.status === 'Absent' ? 'checked' : ''}>
              <span class="toggle-btn" data-present="Present" data-absent="Absent"></span>
            </label>
          </td>
        </tr>
      `).join('');
    }
    
    if (students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; color: var(--text-muted);">No approved students found in this class</td></tr>';
    }

    // Note + submit button visibility
    const note = document.getElementById('attendanceRecordedNote');
    const btn = document.getElementById('attendanceSubmitBtn');
    if (allRecorded) {
      if (note) { note.classList.remove('hidden'); note.textContent = '✓ Attendance already recorded for this date — showing result only. Tap a row to mark it viewed.'; }
      if (btn) btn.style.display = 'none';
    } else {
      if (note) note.classList.add('hidden');
      if (btn) btn.style.display = '';
    }
    
    document.getElementById('attendanceListContainer').classList.remove('hidden');
  } catch(e) {}
}

function markAttViewed(key, studentId) {
  markViewed(key, studentId);
  loadAttendanceStudents();
}

async function submitAttendance() {
  const classId = document.getElementById('attendanceClass').value;
  const date = document.getElementById('attendanceDate').value;
  
  if (!classId || !date || currentAttendanceList.length === 0) return;
  
  const attendance_data = [];
  
  currentAttendanceList.forEach(s => {
    const checkbox = document.getElementById(`att_${s.id}`);
    const status = checkbox.checked ? 'Absent' : 'Present';
    attendance_data.push({ student_id: s.id, status });
  });
  
  try {
    const res = await apiCall('/api/staff/attendance', { 
      method: 'POST', 
      body: { class_id: classId, date, attendance_data } 
    });
    showNotification(res.message);
  } catch(e) {}
}

// Student Functions
async function loadStudentData() {
  loadClasses('stuClass');
  populateDateSelects('gradeDay', 'gradeMonth', 'gradeYear');
  loadStaffList();
  loadStudentInbox();
    loadStudentAssignments();
  loadStudentQuizzes();
    loadStudentWeekCourses();
  loadStudentTopics();
  loadStudentLeaves();
  loadStudentMentor();
  
  try {
    const detailsRes = await apiCall('/api/student/details');
    if (detailsRes.details && detailsRes.details.full_name) {
      document.getElementById('studentUpdateProfileSection').classList.add('hidden');
      document.getElementById('studentDisplayProfileSection').classList.remove('hidden');
      
      document.getElementById('dispStuName').textContent = detailsRes.details.full_name;
      document.getElementById('dispStuClass').textContent = detailsRes.details.class_name;
      document.getElementById('dispStuPhone').textContent = detailsRes.details.phone;
      document.getElementById('dispStuAddress').textContent = detailsRes.details.address;
    } else {
      document.getElementById('studentUpdateProfileSection').classList.remove('hidden');
      document.getElementById('studentDisplayProfileSection').classList.add('hidden');
    }
  } catch(e) {}

  try {
    const materials = await apiCall('/api/student/materials');
    const matList = document.getElementById('stuMaterials');
    matList.innerHTML = materials.length ? materials.map(m => `
      <li style="margin-bottom: 0.5rem; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px;">
        <div>
          <strong>${m.title}</strong>
          <div style="font-size:0.8rem; color:var(--text-muted)">By ${m.staff_name}</div>
        </div>
        <a href="${m.file_url}" target="_blank" class="btn btn-secondary">⬇️ Download</a>
      </li>
    `).join('') : '<p style="color:var(--text-muted)">No materials available yet.</p>';
    
    const forms = await apiCall('/api/student/forms');
    const formList = document.getElementById('stuForms');
    formList.innerHTML = forms.length ? forms.map(f => `
      <li style="margin-bottom: 0.5rem; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px;">
        <div>
          <strong>${f.title}</strong>
          <div style="font-size:0.8rem; color:var(--text-muted)">Shared by <strong style="color: var(--text-main);">${f.staff_name}</strong></div>
        </div>
        <a href="${f.link}" target="_blank" class="btn btn-secondary">Open Form</a>
      </li>
    `).join('') : '<p style="color:var(--text-muted)">No forms assigned.</p>';
  } catch(e) {
    document.getElementById('stuMaterials').innerHTML = '<p style="color:var(--text-muted)">Complete your profile to view materials.</p>';
  }
}

async function updateStudentDetails() {
  const data = {
    full_name: document.getElementById('stuName').value,
    class_id: document.getElementById('stuClass').value,
    phone: document.getElementById('stuPhone').value,
    address: document.getElementById('stuAddress').value
  };
  try {
    const res = await apiCall('/api/student/details', { method: 'POST', body: data });
    showNotification(res.message);
    loadStudentData(); // refresh materials now that class might be set
  } catch(e) {}
}

// =====================
// Unread Message Polling
// =====================

let unreadPollInterval = null;

function startUnreadPolling() {
  stopUnreadPolling();
  // Poll every 10 seconds
  unreadPollInterval = setInterval(() => {
    updateUnreadCounts();
  }, 10000);
}

function stopUnreadPolling() {
  if (unreadPollInterval) {
    clearInterval(unreadPollInterval);
    unreadPollInterval = null;
  }
}

// Update all unread badges using dedicated unread-counts endpoints
async function updateUnreadCounts() {
  try {
    const role = getMyRole();
    
    if (role === 'student') {
      const data = await apiCall('/api/student/unread-counts');
      
      // Update total badge on "Chat with Staff" heading
      const badge = document.getElementById('unreadBadge');
      if (badge) {
        if (data.total > 0) {
          badge.textContent = data.total > 99 ? '99+' : data.total;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
      
      // Update per-staff badges in the staff chat list
      const staffChatList = document.getElementById('staffChatList');
      if (staffChatList) {
        const staffItems = staffChatList.querySelectorAll('li');
        // Build a map of staff_id -> unread_count
        const unreadMap = {};
        data.perStaff.forEach(item => { unreadMap[item.staff_id] = item.unread_count; });
        
        staffItems.forEach(li => {
          const btn = li.querySelector('.msg-icon-btn');
          if (!btn) return;
          // Extract staff id from onclick attribute
          const match = btn.getAttribute('onclick').match(/openChatWithStaff\((\d+)/);
          if (!match) return;
          const staffId = parseInt(match[1]);
          const count = unreadMap[staffId] || 0;
          
          // Find or create badge element
          let badgeEl = li.querySelector('.unread-badge');
          if (count > 0) {
            if (!badgeEl) {
              badgeEl = document.createElement('span');
              badgeEl.className = 'unread-badge';
              badgeEl.style.cssText = 'position:absolute;top:-6px;right:-6px;background:var(--danger);color:white;border-radius:999px;width:20px;height:20px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:700;';
              btn.parentElement.style.position = 'relative';
              btn.parentElement.appendChild(badgeEl);
            }
            badgeEl.textContent = count > 9 ? '9+' : count;
            badgeEl.style.display = 'flex';
          } else if (badgeEl) {
            badgeEl.style.display = 'none';
          }
        });
      }
    } else if (role === 'staff') {
      const data = await apiCall('/api/staff/unread-counts');
      
      // Update total badge on staff inbox heading
      const badge = document.getElementById('staffUnreadBadge');
      if (badge) {
        if (data.total > 0) {
          badge.textContent = data.total > 99 ? '99+' : data.total;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
      
      // Update per-student badges in the staff inbox list
      const unreadMap = {};
      data.perStudent.forEach(item => { unreadMap[item.student_id] = item.unread_count; });
      
      const inboxItems = document.querySelectorAll('#staffInboxMessages > li');
      inboxItems.forEach(li => {
        const chatBtn = li.querySelector('button');
        if (!chatBtn) return;
        const match = chatBtn.getAttribute('onclick')?.match(/openChatFromInbox\((\d+)/);
        if (!match) return;
        const studentId = parseInt(match[1]);
        const count = unreadMap[studentId] || 0;
        
        // Update the count badge in the message count display
        const countSpan = li.querySelector('.unread-inline-badge');
        if (count > 0) {
          if (!countSpan) {
            // Try to find the count indicator
            const timeDiv = li.querySelector('[style*="font-size:0.75rem"]');
            if (timeDiv) {
              const newBadge = document.createElement('span');
              newBadge.className = 'unread-inline-badge';
              newBadge.style.cssText = 'background:var(--danger);color:white;border-radius:999px;padding:0 6px;font-size:11px;margin-right:6px;font-weight:600;';
              newBadge.textContent = count;
              timeDiv.insertBefore(newBadge, timeDiv.firstChild);
            }
          } else {
            countSpan.textContent = count;
            countSpan.style.display = 'inline';
          }
        } else if (countSpan) {
          countSpan.style.display = 'none';
        }
      });
    }
  } catch(e) {
    // Silently fail on polling errors
  }
}

async function loadStaffList() {
  try {
    const staff = await apiCall('/api/student/staff-list');
    
    // Show staff list with chat buttons + notification badges
    const staffChatList = document.getElementById('staffChatList');
    if (staffChatList) {
      staffChatList.innerHTML = staff.length ? staff.map(s => {
        return `
        <li style="margin-bottom: 0.5rem; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px;">
          <div>
            <strong>${s.username}</strong>
          </div>
          <div style="position:relative;display:inline-flex;">
            <button onclick="openChatWithStaff(${s.id}, '${s.username.replace(/'/g, "\\'")}')" class="msg-icon-btn" title="Open Chat">💬</button>
          </div>
        </li>
      `}).join('') : '<p style="color:var(--text-muted)">No staff available.</p>';
    }
    
    updateUnreadCounts();
  } catch(e) {}
}


// Old checkUnreadMessages is replaced by updateUnreadCounts
async function checkUnreadMessages() {
  updateUnreadCounts();
}

// Student inbox - messages received from staff (used only for unread badge now)
async function loadStudentInbox() {
  // Just used for badge count
  checkUnreadMessages();
}

// Staff inbox functions
async function loadStaffInbox() {
  try {
    const messages = await apiCall('/api/staff/inbox-messages');
    const list = document.getElementById('staffInboxMessages');
    const empty = document.getElementById('staffInboxEmpty');
    
    if (messages.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      checkUnreadMessages();
      return;
    }
    empty.classList.add('hidden');
    checkUnreadMessages();
    
    // Group messages by student_id - show ONE entry per student with message count
    const studentMap = {};
    messages.forEach(m => {
      if (!studentMap[m.student_id]) {
        studentMap[m.student_id] = {
          student_id: m.student_id,
          student_username: m.student_username,
          full_name: m.full_name,
          phone: m.phone || '',
          count: 0,
          latest_message: m.message_text || '(file/photo)',
          latest_time: m.created_at
        };
      }
      studentMap[m.student_id].count++;
      // Keep latest message
      if (new Date(m.created_at) > new Date(studentMap[m.student_id].latest_time)) {
        studentMap[m.student_id].latest_message = m.message_text || '(file/photo)';
        studentMap[m.student_id].latest_time = m.created_at;
      }
    });
    
    const groupedStudents = Object.values(studentMap);
    
    list.innerHTML = groupedStudents.map(s => {
      const studentName = s.full_name || s.student_username;
      const time = new Date(s.latest_time).toLocaleString();
      
      let actionBtns = '';
      if (s.phone) {
        let phone = s.phone.replace(/[\s\-\+\(\)]/g, '');
        if (!phone.startsWith('91') && phone.length === 10) {
          phone = '91' + phone;
        }
        actionBtns += `<a href="https://wa.me/${phone}" target="_blank" class="btn" style="background-color: #25D366; padding: 6px 14px; font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">📱 WhatsApp</a> `;
      }
      actionBtns += `<button onclick="openChatFromInbox(${s.student_id}, '${studentName.replace(/'/g, "\\'")}', '${(s.phone || '').replace(/'/g, "\\'")}')" class="btn btn-secondary" style="padding: 6px 14px; font-size: 13px; display: inline-flex; align-items: center; gap: 4px;">💬 Chat</button>`;
      
      return `
        <li style="margin-bottom: 0.5rem; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px; border-left: 3px solid var(--accent);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <strong style="color: var(--accent);">From: ${studentName} (${s.student_username})</strong>
              <div style="font-size:0.75rem; color:var(--text-muted); margin-top: 4px;">
                ${s.count > 1 ? `<span style="background:var(--danger);color:white;border-radius:999px;padding:0 6px;font-size:11px;margin-right:6px;">${s.count}</span>` : ''}
                ${time}
              </div>
            </div>
          </div>
          <p style="margin-top: 0.5rem; color: var(--text-muted); font-size:0.85rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.latest_message}</p>
          <div style="margin-top: 0.75rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
            ${actionBtns}
          </div>
        </li>
      `;
    }).join('');
  } catch(e) {}
}

// Quick reply from inbox - open chat screen
function openChatFromInbox(studentId, studentName, phone) {
  openChatWithStudent(studentId, studentName, phone);
}

// =====================
// Assignment Functions (Staff)
// =====================

// =====================
// Date / Month / Year Setting Box Helpers (Professional picker)
// =====================

// Populate Day, Month, Year <select> elements for the professional date setting box.
// Each argument is the element id of a <select> (safely ignored if the element is absent).
function populateDateSelects(dayId, monthId, yearId) {
  const day = document.getElementById(dayId);
  const month = document.getElementById(monthId);
  const year = document.getElementById(yearId);

  if (day) {
    let html = '<option value="">Day</option>';
    for (let i = 1; i <= 31; i++) html += `<option value="${i}">${i}</option>`;
    day.innerHTML = html;
  }
  if (month) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    let html = '<option value="">Month</option>';
    months.forEach((m, i) => { html += `<option value="${i + 1}">${m}</option>`; });
    month.innerHTML = html;
  }
  if (year) {
    const now = new Date().getFullYear();
    let html = '<option value="">Year</option>';
    for (let i = now - 5; i <= now + 10; i++) html += `<option value="${i}">${i}</option>`;
    year.innerHTML = html;
  }
}

// Build an ISO datetime string (YYYY-MM-DDTHH:MM) from the professional Due Date
// setting box (dueDay/dueMonth/dueYear/dueTime). Returns null when not fully set.
function buildDueDateTime() {
  const day = document.getElementById('dueDay')?.value;
  const month = document.getElementById('dueMonth')?.value;
  const year = document.getElementById('dueYear')?.value;
  const time = document.getElementById('dueTime')?.value;

  if (!day || !month || !year) return null;

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hhmm = time || '23:59';

  return `${year}-${mm}-${dd}T${hhmm}`;
}

async function createAssignment() {
  const title = document.getElementById('assignTitle').value;
  const class_id = document.getElementById('assignClass').value;
  const description = document.getElementById('assignDesc').value;
  const max_marks = document.getElementById('assignMaxMarks')?.value || 100;
  const due_date = buildDueDateTime();
  
  if (!title || !class_id) return showNotification('Title and class are required', true);
  
  try {
    const res = await apiCall('/api/staff/assignment', { method: 'POST', body: { title, description, class_id, max_marks, due_date } });
    showNotification(res.message);
    document.getElementById('assignTitle').value = '';
    document.getElementById('assignDesc').value = '';
    document.getElementById('assignMaxMarks').value = '100';
    document.getElementById('dueDay').value = '';
    document.getElementById('dueMonth').value = '';
    document.getElementById('dueYear').value = '';
    document.getElementById('dueTime').value = '23:59';
    loadStaffAssignments();
  } catch(e) {}
}

async function loadStaffAssignments() {
  try {
    const assignments = await apiCall('/api/staff/assignments');
    const list = document.getElementById('staffAssignmentsList');
    
    if (assignments.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted); padding:1rem;">No assignments created yet.</p>';
      return;
    }
    
    list.innerHTML = assignments.map(a => {
      const dueDate = a.due_date ? new Date(a.due_date) : null;
      const dueDateStr = dueDate ? dueDate.toLocaleString() : 'No deadline';
      const isOverdue = dueDate && new Date() > dueDate;
      
      return `
      <li onclick="openAssignmentGrade(${a.id}, '${a.title.replace(/'/g, "\\'")}')" style="margin-bottom: 0.5rem; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px; border-left: 3px solid var(--accent); cursor:pointer; transition: all 0.2s;"
        onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.transform='translateX(4px)';"
        onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.transform='translateX(0)';"
        title="Click to open grading page">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem;">
          <div>
            <strong style="color: var(--accent);">${a.title}</strong>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top: 4px;">
               ${a.class_name} · ${new Date(a.created_at).toLocaleDateString()} · Max Marks: ${a.max_marks || 100}
            </div>
            <div style="font-size:0.8rem; margin-top: 4px; color:${isOverdue ? 'var(--danger)' : 'var(--text-muted)'};">
               Due: ${dueDateStr} ${isOverdue ? '· <strong style="color:var(--danger);">Overdue</strong>' : ''}
            </div>
            ${a.description ? `<p style="margin-top: 0.3rem; font-size:0.85rem; color:var(--text-muted);">${a.description}</p>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.2rem; font-weight:700; color: ${a.submission_count > 0 ? 'var(--success)' : 'var(--text-muted)'}">
              ${a.submission_count}
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted);">submitted</div>
            ${a.due_date ? `
              <div style="font-size:0.75rem; margin-top:2px; color:var(--success);"> ${a.on_time_count || 0} on time</div>
              <div style="font-size:0.75rem; color:var(--danger);"> ${a.late_count || 0} late</div>
            ` : ''}
            <div style="font-size:0.8rem; color:${a.graded_count > 0 ? 'var(--primary)' : 'var(--text-muted)'}; margin-top:2px;">
              ${a.graded_count} graded
            </div>
            <div style="margin-top:0.3rem; font-size:11px; color:var(--primary); font-weight:600;"> Click to Grade </div>
          </div>
        </div>
      </li>
      `;
    }).join('');
  } catch(e) {}
}

// Open the dedicated assignment grading page
function openAssignmentGrade(assignmentId, title) {
  window.location.href = `/assignment-grade.html?id=${assignmentId}&title=${encodeURIComponent(title)}`;
}

async function viewSubmissions(assignmentId, title) {
  currentAssignmentId = assignmentId;
  try {
    const data = await apiCall(`/api/staff/assignment/${assignmentId}/submissions`);
    
    document.getElementById('subDetailTitle').textContent = `${title} - Submissions`;
    document.getElementById('subDetailSummary').textContent = `${data.submitted} out of ${data.total} students submitted · Max Marks: ${data.max_marks || 100}`;
    
    const tbody = document.querySelector('#submissionsTable tbody');
    
    if (data.submissions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No submissions yet.</td></tr>';
    } else {
      tbody.innerHTML = data.submissions.map(s => `
        <tr>
          <td><strong>${s.username}</strong></td>
          <td>${s.full_name || '-'}</td>
          <td style="font-size:0.8rem;">${new Date(s.submitted_at).toLocaleString()}</td>
          <td><button class="btn btn-secondary" style="padding:2px 8px; font-size:11px;" onclick="previewFile('${s.file_url}', '${(s.full_name || s.username).replace(/'/g, "\\'")}')">Preview</button></td>
          <td style="text-align:center;">
            ${s.marks !== null && s.marks !== undefined
              ? `<span style="font-weight:700; color:${s.marks >= (data.max_marks || 100) / 2 ? 'var(--success)' : 'var(--danger)'}">${s.marks}/${data.max_marks || 100}</span>`
              : '<span style="color:var(--text-muted); font-size:0.8rem;">Not graded</span>'
            }
          </td>
          <td>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; gap:4px; align-items:center;">
                <input type="number" id="gradeMarks_${s.submission_id}" class="form-control" placeholder="Marks" min="0" max="${data.max_marks || 100}" step="0.5" style="width:80px; padding:3px 8px; font-size:12px;" value="${s.marks !== null && s.marks !== undefined ? s.marks : ''}">
                <button class="btn btn-secondary" style="padding:3px 8px; font-size:11px;" onclick="gradeSubmission(${s.submission_id}, ${data.max_marks || 100})">Save</button>
                ${s.marks !== null && s.marks !== undefined ? `<button class="btn btn-danger" style="padding:3px 8px; font-size:11px;" onclick="removeGrade(${s.submission_id})">X</button>` : ''}
              </div>
              <input type="text" id="gradeFeedback_${s.submission_id}" class="form-control" placeholder="Feedback (optional)" style="padding:3px 8px; font-size:11px;" value="${s.feedback || ''}">
              ${s.graded_at ? `<div style="font-size:10px; color:var(--text-muted);">Graded: ${new Date(s.graded_at).toLocaleString()}</div>` : ''}
            </div>
          </td>
        </tr>
      `).join('');
    }
    
    document.getElementById('submissionDetailPanel').classList.remove('hidden');
  } catch(e) {}
}

async function gradeSubmission(submissionId, maxMarks) {
  const marks = document.getElementById(`gradeMarks_${submissionId}`).value;
  const feedback = document.getElementById(`gradeFeedback_${submissionId}`).value;
  
  if (!marks) return showNotification('Please enter marks', true);
  
  const marksNum = parseFloat(marks);
  if (isNaN(marksNum) || marksNum < 0 || marksNum > maxMarks) {
    return showNotification(`Marks must be between 0 and ${maxMarks}`, true);
  }
  
  try {
    const res = await apiCall(`/api/staff/submission/${submissionId}/grade`, {
      method: 'POST',
      body: { marks: marksNum, feedback: feedback || null }
    });
    showNotification(res.message);
    
    // Refresh the submissions view
    const title = document.getElementById('subDetailTitle').textContent.replace(' - Submissions', '');
    const assignmentId = getCurrentAssignmentId();
    if (assignmentId) {
      viewSubmissions(assignmentId, title);
    }
    loadStaffAssignments();
  } catch(e) {}
}

async function removeGrade(submissionId) {
  if (!confirm('Remove this grade?')) return;
  try {
    const res = await apiCall(`/api/staff/submission/${submissionId}/grade`, { method: 'DELETE' });
    showNotification(res.message);
    
    const title = document.getElementById('subDetailTitle').textContent.replace(' - Submissions', '');
    const assignmentId = getCurrentAssignmentId();
    if (assignmentId) {
      viewSubmissions(assignmentId, title);
    }
    loadStaffAssignments();
  } catch(e) {}
}

let currentAssignmentId = null;

function getCurrentAssignmentId() {
  return currentAssignmentId;
}

// =====================
// File Preview Overlay
// =====================

function previewFile(fileUrl, studentName) {
  const modal = document.getElementById('filePreviewModal');
  const title = document.getElementById('filePreviewTitle');
  const content = document.getElementById('filePreviewContent');
  const downloadLink = document.getElementById('filePreviewDownload');
  
  title.textContent = `${studentName}'s Submission`;
  downloadLink.href = fileUrl;
  
  // Determine file type from extension
  const ext = fileUrl.split('.').pop().toLowerCase();
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v', '3gp'];
  const audioExts = ['mp3', 'wav', 'm4a', 'aac', 'opus', 'flac', 'ogg'];
  const textExts = ['txt', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'ini', 'cfg', 'conf', 'md', 'html', 'htm', 'css', 'js', 'mjs', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'php', 'rb', 'go', 'rs', 'sh', 'bat', 'sql', 'env', 'gitignore', 'vcf'];
  const officeExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'];
  
  // 1. Images - render natively
  if (imageExts.includes(ext)) {
    content.innerHTML = `<img src="${fileUrl}" style="max-width:100%; max-height:70vh; border-radius:8px; display:block; margin:0 auto;">`;
    modal.classList.remove('hidden');
    return;
  }
  
  // 2. Videos - render natively
  if (videoExts.includes(ext)) {
    content.innerHTML = `<video src="${fileUrl}" controls style="max-width:100%; max-height:70vh; border-radius:8px; display:block; margin:0 auto;"></video>`;
    modal.classList.remove('hidden');
    return;
  }
  
  // 3. Audio - render natively
  if (audioExts.includes(ext)) {
    content.innerHTML = `<audio src="${fileUrl}" controls style="width:100%; margin:1rem 0;"></audio>`;
    modal.classList.remove('hidden');
    return;
  }
  
  // 4. PDF - use iframe (browsers have built-in PDF viewer)
  if (ext === 'pdf') {
    content.innerHTML = `
      <iframe src="${fileUrl}" style="width:100%; height:70vh; border:none; border-radius:8px; background:white;"></iframe>
    `;
    modal.classList.remove('hidden');
    return;
  }
  
  // 5. Text-based files - fetch and display as preformatted text
  if (textExts.includes(ext)) {
    content.innerHTML = `
      <div style="text-align:center; padding:1rem; color:var(--text-muted);">
        <span class="preview-loading"> Loading file content...</span>
      </div>
    `;
    modal.classList.remove('hidden');
    
    fetch(fileUrl)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load file');
        return res.text();
      })
      .then(text => {
        // Use textContent for safe rendering (automatically escapes HTML)
        content.innerHTML = '';
        const pre = document.createElement('pre');
        pre.style.cssText = 'background:rgba(0,0,0,0.3); padding:1rem; border-radius:8px; max-height:65vh; overflow:auto; font-size:0.85rem; line-height:1.5; white-space:pre-wrap; word-break:break-word; margin:0;';
        pre.textContent = text;
        content.appendChild(pre);
      })
      .catch(() => {
        content.innerHTML = `
          <div style="text-align:center; padding:2rem;">
            <div style="font-size:3rem; margin-bottom:1rem;"></div>
            <p style="color:var(--text-muted); margin-bottom:1rem;">Could not load file content directly.</p>
            <a href="${fileUrl}" target="_blank" class="btn" style="text-decoration:none;">⬇️ Download File</a>
          </div>
        `;
      });
    return;
  }
  
  // 6. Office documents - use Google Docs Viewer
  if (officeExts.includes(ext)) {
    const viewerUrl = 'https://docs.google.com/viewer?url=' + encodeURIComponent(window.location.origin + fileUrl) + '&embedded=true';
    content.innerHTML = `
      <iframe src="${viewerUrl}" style="width:100%; height:70vh; border:none; border-radius:8px; background:white;"></iframe>
      <div style="text-align:center; margin-top:0.5rem; font-size:0.85rem; color:var(--text-muted);">
        If preview doesn't load, use the Download button below to view the file.
      </div>
    `;
    modal.classList.remove('hidden');
    return;
  }
  
  // 7. Fallback - try iframe, show download as backup
  content.innerHTML = `
    <iframe src="${fileUrl}" style="width:100%; height:70vh; border:none; border-radius:8px; background:white;"></iframe>
    <div style="text-align:center; margin-top:0.5rem; font-size:0.85rem; color:var(--text-muted);">
      If preview doesn't load, use the Download button below to view the file.
    </div>
  `;
  modal.classList.remove('hidden');
}

function closeFilePreview() {
  document.getElementById('filePreviewModal').classList.add('hidden');
  document.getElementById('filePreviewContent').innerHTML = '';
}

// =====================
// Assignment Functions (Student)
// =====================

// Cached list used by the professional Date/Month/Year filter box in "My Grades"
let currentStudentAssignments = [];

async function loadStudentAssignments() {
  try {
    const assignments = await apiCall('/api/student/assignments');
    currentStudentAssignments = assignments;
    const list = document.getElementById('stuAssignmentList');
    
    if (assignments.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted); padding:1rem;">No assignments assigned yet.</p>';
      renderStudentGrades(assignments);
      return;
    }
    
    list.innerHTML = assignments.map(a => {
      const dueDate = a.due_date ? new Date(a.due_date) : null;
      const dueDateStr = dueDate ? dueDate.toLocaleString() : 'No deadline';
      const isOverdue = dueDate && new Date() > dueDate;
      
      return `
      <li style="margin-bottom: 0.5rem; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px; border-left: 3px solid ${a.has_submitted ? (a.my_marks !== null && a.my_marks !== undefined ? 'var(--success)' : 'var(--primary)') : 'var(--primary)'};">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem;">
          <div>
            <strong style="color: ${a.has_submitted ? (a.my_marks !== null && a.my_marks !== undefined ? 'var(--success)' : 'var(--primary)') : 'var(--primary)'};">${a.title}</strong>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top: 4px;">
              By ${a.staff_name} · ${new Date(a.created_at).toLocaleDateString()} · Max Marks: ${a.max_marks || 100}
            </div>
            <div style="font-size:0.8rem; margin-top: 4px; color:${isOverdue ? 'var(--danger)' : 'var(--text-muted)'};">
               Due: ${dueDateStr} ${isOverdue ? '· <strong style="color:var(--danger);">Overdue</strong>' : ''}
            </div>
            ${a.description ? `<p style="margin-top: 0.3rem; font-size:0.85rem; color:var(--text-muted);">${a.description}</p>` : ''}
            ${a.my_feedback ? `<div style="margin-top: 0.4rem; font-size:0.8rem; color:var(--text-muted); background:rgba(16,185,129,0.08); padding:0.4rem 0.6rem; border-radius:4px; border-left:3px solid var(--success);"><strong>Feedback:</strong> ${a.my_feedback}</div>` : ''}
          </div>
          <div style="text-align:right;">
            ${a.my_marks !== null && a.my_marks !== undefined
              ? `<div style="font-size:1.4rem; font-weight:700; color:${a.my_marks >= (a.max_marks || 100) / 2 ? 'var(--success)' : 'var(--danger)'};">${a.my_marks}/${a.max_marks || 100}</div>
                <span class="badge badge-success" style="display:inline-block;margin-bottom:0.3rem;"> Graded</span><br>`
              : a.has_submitted
                ? `<span class="badge badge-warning" style="display:inline-block;margin-bottom:0.3rem;"> Submitted (pending grade)</span><br>`
                : ''
            }
            <label class="btn btn-secondary" style="cursor:pointer; padding:4px 12px; font-size:12px; display:inline-flex; align-items:center; gap:4px;">
               Upload
              <input type="file" id="assignFile_${a.id}" style="display:none" onchange="submitAssignment(${a.id})">
            </label>
          </div>
        </div>
      </li>
      `;
    }).join('');
    
    renderStudentGrades(assignments);
  } catch(e) {
    currentStudentAssignments = [];
    document.getElementById('stuAssignmentList').innerHTML = '<p style="color:var(--text-muted); padding:1rem;">Complete your profile to see assignments.</p>';
    renderStudentGrades([]);
  }
}

async function submitAssignment(assignmentId) {
  const fileInput = document.getElementById(`assignFile_${assignmentId}`);
  const file = fileInput.files[0];
  
  if (!file) return;
  
  const fd = new FormData();
  fd.append('assignment_id', assignmentId);
  fd.append('assignmentFile', file);
  
  try {
    const res = await apiCall('/api/student/submit-assignment', { method: 'POST', body: fd });
    showNotification(res.message);
    loadStudentAssignments();
  } catch(e) {}
}

// Render student grades summary table
function renderStudentGrades(assignments) {
  const tbody = document.querySelector('#studentGradesTable tbody');
  const summary = document.getElementById('studentGradesSummary');
  if (!tbody) return;
  
  const graded = assignments.filter(a => a.my_marks !== null && a.my_marks !== undefined);
  const submitted = assignments.filter(a => a.has_submitted);
  
  // Summary info
  if (graded.length > 0) {
    const totalEarned = graded.reduce((sum, a) => sum + parseFloat(a.my_marks || 0), 0);
    const totalPossible = graded.reduce((sum, a) => sum + parseFloat(a.max_marks || 100), 0);
    const pct = totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : 0;
    summary.innerHTML = `<strong style="color:var(--text-main);">${graded.length}</strong> graded · <strong style="color:var(--text-main);">${submitted.length}</strong> submitted · Overall: <strong style="color:${pct >= 50 ? 'var(--success)' : 'var(--danger)'};">${pct}%</strong>`;
  } else {
    summary.textContent = 'No grades assigned yet.';
  }
  
  tbody.innerHTML = assignments.map(a => {
    const mark = a.my_marks !== null && a.my_marks !== undefined ? a.my_marks : null;
    const maxM = a.max_marks || 100;
    const status = mark !== null
      ? `<span style="font-weight:600;color:${mark >= maxM / 2 ? 'var(--success)' : 'var(--danger)'};">${mark}/${maxM}</span>`
      : a.has_submitted
        ? '<span class="badge badge-warning" style="font-size:0.7rem;"> Pending</span>'
        : '<span style="color:var(--text-muted);font-size:0.8rem;">Not submitted</span>';
    
    return `
      <tr>
        <td>${a.title}</td>
        <td>${a.staff_name || '-'}</td>
        <td>${mark !== null ? mark + '/' + maxM : '-'}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join('');
  
  if (assignments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No assignments yet.</td></tr>';
  }
}

// =====================
// Student Grades Date/Month/Year Filter
// =====================

// Filter the "My Grades" table by the selected Date/Month/Year (matched on each
// assignment's created_at). Empty selection shows every assignment.
function filterStudentGrades() {
  const day = document.getElementById('gradeDay')?.value;
  const month = document.getElementById('gradeMonth')?.value;
  const year = document.getElementById('gradeYear')?.value;

  if (!year && !month && !day) {
    renderStudentGrades(currentStudentAssignments);
    return;
  }

  const filtered = currentStudentAssignments.filter(a => {
    if (!a.created_at) return false;
    const d = new Date(a.created_at);
    if (year && year !== String(d.getFullYear())) return false;
    if (month && month !== String(d.getMonth() + 1)) return false;
    if (day && day !== String(d.getDate())) return false;
    return true;
  });

  renderStudentGrades(filtered);
}

// Reset the grades Date/Month/Year filter back to showing every assignment.
function resetGradeDateFilter() {
  const dEl = document.getElementById('gradeDay');
  const mEl = document.getElementById('gradeMonth');
  const yEl = document.getElementById('gradeYear');
  if (dEl) dEl.value = '';
  if (mEl) mEl.value = '';
  if (yEl) yEl.value = '';
  renderStudentGrades(currentStudentAssignments);
}



// =====================
// Quiz Functions (Staff)
// =====================

let quizQuestionCount = 0;

function addQuizQuestion() {
  quizQuestionCount++;
  const container = document.getElementById('quizQuestionsContainer');
  const div = document.createElement('div');
  div.id = `quiz_q_${quizQuestionCount}`;
  div.style.cssText = 'background:rgba(255,255,255,0.05);padding:1rem;border-radius:8px;margin-bottom:0.75rem;border:1px solid var(--card-border);';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
      <strong>Question ${quizQuestionCount}</strong>
      <button class="btn btn-danger" style="padding:2px 10px;font-size:12px;" onclick="removeQuizQuestion(${quizQuestionCount})">X</button>
    </div>
    <div class="form-group" style="margin-bottom:0.5rem;">
      <input type="text" id="q_text_${quizQuestionCount}" class="form-control" placeholder="Question text..." style="font-weight:500;">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
      <div class="form-group" style="margin-bottom:0;">
        <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:4px;">
          <input type="radio" name="correct_${quizQuestionCount}" value="a" style="accent-color:var(--success);">
          A) <input type="text" id="q_opt_a_${quizQuestionCount}" class="form-control" placeholder="Option A" style="padding:6px 10px;font-size:13px;margin-left:4px;">
        </label>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:4px;">
          <input type="radio" name="correct_${quizQuestionCount}" value="b" style="accent-color:var(--success);">
          B) <input type="text" id="q_opt_b_${quizQuestionCount}" class="form-control" placeholder="Option B" style="padding:6px 10px;font-size:13px;margin-left:4px;">
        </label>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:4px;">
          <input type="radio" name="correct_${quizQuestionCount}" value="c" style="accent-color:var(--success);">
          C) <input type="text" id="q_opt_c_${quizQuestionCount}" class="form-control" placeholder="Option C" style="padding:6px 10px;font-size:13px;margin-left:4px;">
        </label>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:4px;">
          <input type="radio" name="correct_${quizQuestionCount}" value="d" style="accent-color:var(--success);">
          D) <input type="text" id="q_opt_d_${quizQuestionCount}" class="form-control" placeholder="Option D" style="padding:6px 10px;font-size:13px;margin-left:4px;">
        </label>
      </div>
    </div>
  `;
  container.appendChild(div);
}

function removeQuizQuestion(id) {
  const el = document.getElementById(`quiz_q_${id}`);
  if (el) el.remove();
}

async function createQuiz() {
  const title = document.getElementById('quizTitle').value;
  const class_id = document.getElementById('quizClass').value;
  const description = document.getElementById('quizDesc').value;
  const quiz_password = document.getElementById('quizPassword').value.trim();

  if (!title || !class_id) return showNotification('Title and class are required', true);

  // Collect questions
  const questions = [];
  const qElements = document.querySelectorAll('[id^="quiz_q_"]');
  
  for (const el of qElements) {
    const id = el.id.replace('quiz_q_', '');
    const question_text = document.getElementById(`q_text_${id}`)?.value;
    const option_a = document.getElementById(`q_opt_a_${id}`)?.value;
    const option_b = document.getElementById(`q_opt_b_${id}`)?.value;
    const option_c = document.getElementById(`q_opt_c_${id}`)?.value;
    const option_d = document.getElementById(`q_opt_d_${id}`)?.value;
    
    // Get selected correct answer
    const correctRadio = document.querySelector(`input[name="correct_${id}"]:checked`);
    const correct_answer = correctRadio ? correctRadio.value : '';

    if (!question_text || !option_a || !option_b || !option_c || !option_d || !correct_answer) {
      return showNotification('Please fill all fields for each question and select the correct answer', true);
    }

    questions.push({ question_text, option_a, option_b, option_c, option_d, correct_answer });
  }

  if (questions.length === 0) return showNotification('Add at least one question', true);

  try {
    const res = await apiCall('/api/staff/quiz', {
      method: 'POST',
      body: { title, description, class_id, questions, quiz_password: quiz_password || null }
    });
    showNotification(res.message);
    
    // Reset form
    document.getElementById('quizTitle').value = '';
    document.getElementById('quizDesc').value = '';
    document.getElementById('quizPassword').value = '';
    document.getElementById('quizClass').value = '';
    document.getElementById('quizQuestionsContainer').innerHTML = '';
    quizQuestionCount = 0;
    
    loadStaffQuizzes();
  } catch(e) {
    console.error('createQuiz error:', e);
    showNotification('Failed to create quiz: ' + (e.message || 'Unknown error'), true);
  }
}

async function loadStaffQuizzes() {
  try {
    const quizzes = await apiCall('/api/staff/quizzes');
    const list = document.getElementById('staffQuizzesList');
    
    if (quizzes.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);">No quizzes created yet.</p>';
      return;
    }

    list.innerHTML = quizzes.map(q => `
      <li style="margin-bottom: 0.5rem; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px; border-left: 3px solid var(--accent);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem;">
          <div>
            <strong style="color: var(--accent);">${q.title}</strong>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top: 4px;">
               ${q.class_name} · ${new Date(q.created_at).toLocaleDateString()}
               ${q.has_password ? ' · <span style="color:var(--accent);font-weight:600;">🔒 Password</span>' : ''}
            </div>
            ${q.description ? `<p style="margin-top: 0.3rem; font-size:0.85rem; color:var(--text-muted);">${q.description}</p>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.2rem; font-weight:700; color: ${q.attempt_count > 0 ? 'var(--success)' : 'var(--text-muted)'}">
              ${q.attempt_count}
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted);">attempts</div>
            <button class="btn btn-secondary" style="margin-top:0.3rem; padding:4px 12px; font-size:12px;" onclick="viewQuizResults(${q.id}, '${q.title.replace(/'/g, "\\'")}')">Results</button>
          </div>
        </div>
      </li>
    `).join('');
  } catch(e) {}
}

async function viewQuizResults(quizId, title) {
  try {
    const data = await apiCall(`/api/staff/quiz/${quizId}/results`);
    
    document.getElementById('staffQuizResultsTitle').textContent = `${title} - Results`;
    document.getElementById('staffQuizResultsSummary').textContent = `${data.submitted} out of ${data.total} students attempted`;
    
    const tbody = document.querySelector('#staffQuizResultsTable tbody');
    
    if (data.attempts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No attempts yet.</td></tr>';
    } else {
      tbody.innerHTML = data.attempts.map(a => `
        <tr>
          <td><strong>${a.username}</strong></td>
          <td>${a.full_name || '-'}</td>
          <td><span style="font-weight:600;color:${a.score >= a.total_questions/2 ? 'var(--success)' : 'var(--danger)'}">${a.score}/${a.total_questions}</span></td>
          <td style="font-size:0.8rem;">${new Date(a.submitted_at).toLocaleString()}</td>
        </tr>
      `).join('');
    }
    
    document.getElementById('staffQuizResultsModal').classList.remove('hidden');
  } catch(e) {}
}

function closeStaffQuizResultsModal() {
  document.getElementById('staffQuizResultsModal').classList.add('hidden');
}

// =====================
// Quiz Functions (Student)
// =====================

let currentQuizId = null;
let quizPasswordMode = null; // 'normal' | 'week' — which quiz the password modal is unlocking

// ====================================================
// Viewed-state helpers (sessionStorage backed)
// Used to color code items after they've been viewed.
// ====================================================
const QUIZ_VIEWED_KEY = 'viewedQuizzes';
const WEEK_QUIZ_VIEWED_KEY = 'viewedWeekQuizzes';
const ATT_VIEWED_PREFIX = 'viewedAtt';

function getViewedList(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || '[]'); } catch(e) { return []; }
}
function setViewedList(key, list) {
  try { sessionStorage.setItem(key, JSON.stringify(list)); } catch(e) {}
}
function markViewed(key, id) {
  const list = getViewedList(key);
  const strId = String(id);
  if (!list.includes(strId)) { list.push(strId); setViewedList(key, list); }
}
function isViewed(key, id) {
  return getViewedList(key).includes(String(id));
}

async function loadStudentQuizzes() {
  try {
    const quizzes = await apiCall('/api/student/quizzes');
    const list = document.getElementById('stuQuizList');
    
    if (quizzes.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);">No quizzes available yet.</p>';
      return;
    }

    list.innerHTML = quizzes.map(q => `
      <li style="margin-bottom: 0.5rem; background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px; border-left: 3px solid ${q.has_attempted ? 'var(--success)' : 'var(--primary)'};">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.5rem;">
          <div>
            <strong style="color: ${q.has_attempted ? 'var(--success)' : 'var(--primary)'};">${q.title}</strong>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top: 4px;">
              By ${q.staff_name} · ${new Date(q.created_at).toLocaleDateString()}
            </div>
            ${q.description ? `<p style="margin-top: 0.3rem; font-size:0.85rem; color:var(--text-muted);">${q.description}</p>` : ''}
          </div>
          <div style="text-align:right;">
            ${q.has_attempted 
              ? `<div><span class="badge badge-success" style="display:inline-block;margin-bottom:0.3rem;"> Completed</span><br><button class="btn btn-secondary" style="padding:4px 12px; font-size:12px;" onclick="viewQuizResult(${q.id})">View Result</button></div>`
              : `<button class="btn" style="padding:4px 12px; font-size:12px;" onclick="startQuiz(${q.id}, ${q.has_password ? 1 : 0})">Attempt Quiz</button>`
            }
          </div>
        </div>
      </li>
    `).join('');
  } catch(e) {
    document.getElementById('stuQuizList').innerHTML = '<p style="color:var(--text-muted);">Complete your profile to see quizzes.</p>';
  }
}

// Shared question renderer used by regular and week quizzes
function buildQuizQuestionsHtml(questions) {
  return questions.map((q, idx) => `
    <div style="background:rgba(255,255,255,0.05);padding:1rem;border-radius:8px;margin-bottom:1rem;border:1px solid var(--card-border);">
      <p style="font-weight:600;margin-bottom:0.75rem;">${idx + 1}. ${q.question_text}</p>
      <div style="display:grid;gap:0.5rem;">
        <label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid var(--card-border);transition:all 0.2s;"
            onmouseover="this.style.background='rgba(16,185,129,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
          <input type="radio" name="q_${q.id}" value="a" style="accent-color:var(--success);">
          <span>A) ${q.option_a}</span>
        </label>
        <label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid var(--card-border);transition:all 0.2s;"
            onmouseover="this.style.background='rgba(16,185,129,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
          <input type="radio" name="q_${q.id}" value="b" style="accent-color:var(--success);">
          <span>B) ${q.option_b}</span>
        </label>
        <label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid var(--card-border);transition:all 0.2s;"
            onmouseover="this.style.background='rgba(16,185,129,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
          <input type="radio" name="q_${q.id}" value="c" style="accent-color:var(--success);">
          <span>C) ${q.option_c}</span>
        </label>
        <label style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid var(--card-border);transition:all 0.2s;"
            onmouseover="this.style.background='rgba(16,185,129,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
          <input type="radio" name="q_${q.id}" value="d" style="accent-color:var(--success);">
          <span>D) ${q.option_d}</span>
        </label>
      </div>
    </div>
  `).join('');
}

async function startQuiz(quizId, hasPassword) {
  // Password-protected quiz: ask for the password first
  if (hasPassword) {
    quizPasswordMode = 'normal';
    currentQuizId = quizId;
    document.getElementById('weekQuizPassword').value = '';
    document.getElementById('weekQuizPasswordDesc').textContent = 'This quiz is protected. Enter the password set by your instructor to unlock it.';
    document.getElementById('weekQuizPasswordModal').classList.remove('hidden');
    return;
  }
  try {
    const data = await apiCall(`/api/student/quiz/${quizId}`);

    quizMode = 'regular';
    currentQuizId = quizId;
    document.getElementById('quizAttemptTitle').textContent = data.quiz.title;
    document.getElementById('quizAttemptDesc').textContent = data.quiz.description || 'Answer all the questions below';

    document.getElementById('quizAttemptQuestions').innerHTML = buildQuizQuestionsHtml(data.questions);

    document.getElementById('quizAttemptModal').classList.remove('hidden');
  } catch(e) {
    if (e.message) showNotification(e.message, true);
  }
}

function closeQuizAttemptModal() {
  document.getElementById('quizAttemptModal').classList.add('hidden');
  currentQuizId = null;
  currentWeekQuizId = null;
  quizMode = 'regular';
}

async function submitQuizAttempt() {
  if (quizMode === 'weekQuiz') {
    return submitWeekQuizAttempt();
  }
  if (!currentQuizId) return;
  
  // Collect answers
  const questions = document.querySelectorAll('#quizAttemptQuestions > div');
  const answers = {};
  let allAnswered = true;
  const totalQ = questions.length;
  
  questions.forEach(div => {
    const radioName = div.querySelector('input[type="radio"]')?.name;
    if (radioName) {
      const selected = document.querySelector(`input[name="${radioName}"]:checked`);
      const qId = radioName.replace('q_', '');
      if (selected) {
        answers[qId] = selected.value;
      } else {
        allAnswered = false;
      }
    }
  });
  
  if (!allAnswered) {
    if (!confirm('You have not answered all questions. Submit anyway?')) return;
  }
  
  try {
    const res = await apiCall(`/api/student/quiz/${currentQuizId}/submit`, {
      method: 'POST',
      body: { answers }
    });
    
    closeQuizAttemptModal();
    showNotification(`Quiz submitted! Score: ${res.score}/${res.total}`);
    loadStudentQuizzes();
  } catch(e) {}
}

async function viewQuizResult(quizId) {
  try {
    const data = await apiCall(`/api/student/quiz/${quizId}/result`);
    
    document.getElementById('quizResultTitle').textContent = data.title;
    document.getElementById('quizResultScore').textContent = `${data.score}/${data.total_questions}`;
    document.getElementById('quizResultScore').style.color = data.score >= data.total_questions/2 ? 'var(--success)' : 'var(--danger)';
    document.getElementById('quizResultDetails').textContent = `Submitted on ${new Date(data.submitted_at).toLocaleString()}`;
    
    const answersDiv = document.getElementById('quizResultAnswers');
    if (data.answers && data.answers.length > 0) {
      answersDiv.innerHTML = '<h4 style="margin-bottom:0.5rem;">Question Details</h4>' + 
        data.answers.map((a, idx) => `
          <div style="padding:0.5rem;margin-bottom:0.3rem;border-radius:4px;background:${a.isCorrect ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'};border-left:3px solid ${a.isCorrect ? 'var(--success)' : 'var(--danger)'};">
            <strong>Q${idx + 1}:</strong> Your answer: ${a.studentAnswer || '(not answered)'} 
            ${!a.isCorrect ? `<span style="color:var(--success);">· Correct: ${a.correctAnswer}</span>` : ''}
          </div>
        `).join('');
    }
    
    document.getElementById('quizResultModal').classList.remove('hidden');
  } catch(e) {}
}

function closeQuizResultModal() {
  document.getElementById('quizResultModal').classList.add('hidden');
}

function showStaffFeature(featureName, btn) {
  document.querySelectorAll('.staff-nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  }

  const featureIds = [
    'staffFeatureMaterials',
    'staffFeatureAttendance',
    'staffFeatureForms',
    'staffFeatureAssignments',
    'staffFeatureQuizzes',
    'staffFeatureLeaves',
    'staffFeatureWeekCourses',
    'staffFeatureInbox',
    'staffFeatureStudents',
    'staffFeatureStaffList',
    'staffFeatureProfile'
  ];

  featureIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id.toLowerCase().includes(featureName.toLowerCase())) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });
}

async function loadStaffProfile() {
  try {
    const res = await apiCall('/api/staff/details');
    if (res.details) {
      // Profile exists — show display section, hide edit section
      document.getElementById('staffProfileEditSection').classList.add('hidden');
      document.getElementById('staffProfileDisplaySection').classList.remove('hidden');
      
      document.getElementById('dispStaffName').textContent = res.details.full_name || '-';
      document.getElementById('dispStaffId').textContent = res.details.staff_id || '-';
      document.getElementById('dispStaffAge').textContent = res.details.age || '-';
      document.getElementById('dispStaffAadhaar').textContent = res.details.aadhaar || '-';
      document.getElementById('dispStaffPhone').textContent = res.details.phone || '-';
    } else {
      // No profile — show edit section, hide display section
      document.getElementById('staffProfileEditSection').classList.remove('hidden');
      document.getElementById('staffProfileDisplaySection').classList.add('hidden');
      
      // Clear form fields for fresh entry
      document.getElementById('staffProfileName').value = '';
      document.getElementById('staffProfileId').value = '';
      document.getElementById('staffProfileAge').value = '';
      document.getElementById('staffProfileAadhaar').value = '';
      document.getElementById('staffProfilePhone').value = '';
    }
  } catch(e) {
    // On error, show edit section as fallback
    document.getElementById('staffProfileEditSection').classList.remove('hidden');
    document.getElementById('staffProfileDisplaySection').classList.add('hidden');
  }
}

async function saveStaffProfile() {
  const full_name = document.getElementById('staffProfileName').value;
  const staff_id = document.getElementById('staffProfileId').value;
  const age = document.getElementById('staffProfileAge').value;
  const aadhaar = document.getElementById('staffProfileAadhaar').value;
  const phone = document.getElementById('staffProfilePhone').value;

  if (!full_name) {
    return showNotification('Full Name is required', true);
  }

  try {
    const res = await apiCall('/api/staff/details', {
      method: 'POST',
      body: { full_name, staff_id, age, aadhaar, phone }
    });
    showNotification(res.message);
    loadStaffProfile(); // Will now switch to display view
    loadEnrolledStaff();
  } catch(e) {
    showNotification(e.message || 'Failed to save staff profile', true);
  }
}

let currentEnrolledStaff = [];

async function loadEnrolledStaff() {
  try {
    const staff = await apiCall('/api/all-staff');
    currentEnrolledStaff = staff;
    renderEnrolledStaff(staff);
  } catch(e) {}
}

function renderEnrolledStaff(staffList) {
  const tbody = document.querySelector('#staffEnrolledTable tbody');
  if (!tbody) return;
  tbody.innerHTML = staffList.map(st => `
    <tr>
      <td><strong>${st.username}</strong></td>
      <td>${st.full_name || '-'}</td>
      <td>${st.staff_id || '-'}</td>
      <td>${st.age || '-'}</td>
      <td>${st.aadhaar || '-'}</td>
      <td>${st.phone || '-'}</td>
    </tr>
  `).join('');

  if (staffList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">No staff members found</td></tr>';
  }
}

function filterEnrolledStaff() {
  const query = (document.getElementById('enrolledStaffSearch')?.value || '').toLowerCase();
  const filtered = currentEnrolledStaff.filter(st => st.username.toLowerCase().includes(query));
  renderEnrolledStaff(filtered);
}

// ====================================================
// Week Courses — shared state
let currentCourseId = null;
let currentWeekAssignmentId = null;
let currentStudentCourseId = null;
let currentWeekQuizId = null;
let quizMode = 'regular';
let weekQuizQuestionCount = 0;

// ====================================================
// Week Courses — Staff: listing + course creation
async function loadStaffWeekCourses() {
  try {
    const courses = await apiCall('/api/staff/courses');
    const list = document.getElementById('weekCoursesList');
    if (!list) return;
    if (!courses || courses.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No courses created yet. Create your first multi-week course below!</p>';
      return;
    }
    list.innerHTML = courses.map(c => `
      <li style="margin-bottom:0.75rem;background:rgba(255,255,255,0.05);padding:1rem;border-radius:8px;border-left:3px solid var(--accent);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;">
          <div>
            <strong style="color:var(--accent);font-size:1.1rem;">${c.title}</strong>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">
              ${c.class_name || 'All Classes'} · ${c.total_weeks} weeks · Created ${new Date(c.created_at).toLocaleDateString()}
            </div>
            ${c.description ? `<p style="margin-top:0.3rem;font-size:0.85rem;color:var(--text-muted);">${c.description}</p>` : ''}
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">
              ${c.assignment_count} assignments · ${c.quiz_count} quizzes
            </div>
          </div>
          <div style="display:flex;gap:0.4rem;">
            <button class="btn btn-secondary" style="padding:4px 12px;font-size:11px;" onclick="openWeekCourse(${c.id})">Manage</button>
            <button class="btn" style="background-color:var(--danger);padding:4px 12px;font-size:11px;" onclick="deleteWeekCourse(${c.id})">Delete</button>
          </div>
        </div>
      </li>
    `).join('');
  } catch(e) {}
}

async function createWeekCourse() {
  const title = document.getElementById('courseTitle').value.trim();
  const weeks = document.getElementById('courseWeeks').value;
  const classId = document.getElementById('courseClass').value;
  const description = document.getElementById('courseDesc').value;
  if (!title || !weeks) return showNotification('Please enter a course title and number of weeks', true);
  try {
    const res = await apiCall('/api/staff/course', {
      method: 'POST',
      body: { title, description, total_weeks: parseInt(weeks), class_id: classId || null }
    });
    showNotification(res.message);
    resetWeekCourseForm();
    loadStaffWeekCourses();
  } catch(e) {}
}

function resetWeekCourseForm() {
  ['courseTitle','courseWeeks','courseClass','courseDesc'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
}

async function deleteWeekCourse(courseId) {
  if (!confirm('Delete this course? All assignments and quizzes for every week will be permanently removed.')) return;
  try {
    const res = await apiCall(`/api/staff/course/${courseId}`, { method: 'DELETE' });
    showNotification(res.message);
    if (courseId === currentCourseId) closeWeekCourseModal();
    loadStaffWeekCourses();
  } catch(e) {}
}
async function openWeekCourse(courseId) {
  try {
    const data = await apiCall(`/api/staff/course/${courseId}`);
    // Fetch materials separately for this course
    try {
      data.materials = await apiCall(`/api/staff/course/${courseId}/materials`);
    } catch(e) {
      data.materials = [];
    }
    currentCourseId = data.course.id;
    document.getElementById('weekCourseModalTitle').textContent = data.course.title;
    document.getElementById('weekCourseInfo').textContent =
      `${data.course.class_name || 'All Classes'} · ${data.course.total_weeks} weeks · Created ${new Date(data.course.created_at).toLocaleDateString()}`;
    const weekSelect = document.getElementById('weekSelector');
    let opts = '<option value="">-- Choose a week --</option>';
    for (let i = 1; i <= data.course.total_weeks; i++) opts += `<option value="${i}">Week ${i}</option>`;
    weekSelect.innerHTML = opts;
    document.getElementById('weekCourseContent').innerHTML = '';
    window.__currentCourseData = data;
    weekQuizQuestionCount = 0;
    document.getElementById('weekCourseModal').classList.remove('hidden');
  } catch(e) {}
}

function closeWeekCourseModal() {
  const m = document.getElementById('weekCourseModal');
  if (m) m.classList.add('hidden');
  currentCourseId = null;
  window.__currentCourseData = null;
  const c = document.getElementById('weekCourseContent');
  if (c) c.innerHTML = '';
  const s = document.getElementById('weekSelector');
  if (s) s.innerHTML = '<option value="">-- Choose a week --</option>';
}

async function refreshWeekCourseData() {
  if (currentCourseId) {
    window.__currentCourseData = await apiCall(`/api/staff/course/${currentCourseId}`);
    try {
      window.__currentCourseData.materials = await apiCall(`/api/staff/course/${currentCourseId}/materials`);
    } catch(e) {
      window.__currentCourseData.materials = [];
    }
    loadCourseWeekContent();
  }
}

async function loadCourseWeekContent() {
  const data = window.__currentCourseData;
  if (!data) return;
  const week = parseInt(document.getElementById('weekSelector').value);
  if (!week) {
    document.getElementById('weekCourseContent').innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Select a week above to manage its assignment and quiz.</p>';
    return;
  }
  const assignment = (data.assignments || []).find(a => parseInt(a.week_number) === week);
  const quiz = (data.quizzes || []).find(q => parseInt(q.week_number) === week);
  const materials = (data.materials || []).filter(m => parseInt(m.week_number) === week);
  document.getElementById('weekCourseContent').innerHTML = `
    <div style="display:flex;gap:1.5rem;flex-wrap:wrap;">
      <div style="flex:1;min-width:280px;">
        <h4 style="margin-bottom:0.5rem;border-bottom:1px solid var(--card-border);padding-bottom:0.3rem;">Week ${week} Assignment</h4>
        ${assignment ? weekAssignmentItemHtml(assignment) : weekAssignmentFormHtml(week)}
      </div>
      <div style="flex:1;min-width:280px;">
        <h4 style="margin-bottom:0.5rem;border-bottom:1px solid var(--card-border);padding-bottom:0.3rem;">Week ${week} Quiz</h4>
        ${quiz ? weekQuizItemHtml(quiz) : weekQuizFormHtml(week)}
      </div>
    </div>
    <div style="margin-top:1.5rem;">
      <h4 style="margin-bottom:0.5rem;border-bottom:1px solid var(--card-border);padding-bottom:0.3rem;">Week ${week} Materials</h4>
      ${weekMaterialsHtml(week, materials)}
    </div>`;
}
function weekAssignmentFormHtml(week) {
  return `
  <form onsubmit="event.preventDefault(); createWeekAssignment(${week});">
    <div class="form-group"><label>Assignment Title</label>
      <input type="text" id="weekAsnTitle_${week}" class="form-control" placeholder="e.g. Week ${week} Report"></div>
    <div class="form-group"><label>Description</label>
      <textarea id="weekAsnDesc_${week}" class="form-control" rows="2" placeholder="Assignment details..."></textarea></div>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
      <div class="form-group" style="flex:1;min-width:140px;"><label>Due Date &amp; Time</label>
        <input type="datetime-local" id="weekAsnDue_${week}" class="form-control"></div>
      <div class="form-group" style="flex:1;min-width:140px;"><label>File Type</label>
        <select id="weekAsnType_${week}" class="form-control">
          <option value="any">Any (PDF/CSV/MP4...)</option><option value="pdf">PDF</option><option value="csv">CSV</option><option value="mp4">MP4</option>
        </select></div>
      <div class="form-group" style="flex:1;min-width:100px;"><label>Max Marks</label>
        <input type="number" id="weekAsnMarks_${week}" class="form-control" value="100" min="1"></div>
    </div>
    <button class="btn" type="submit">Create Assignment</button>
  </form>`;
}

function weekAssignmentItemHtml(a) {
  const due = a.due_date ? `Due: ${new Date(a.due_date).toLocaleString()}` : 'No deadline';
  return `
  <div style="background:rgba(255,255,255,0.05);padding:0.8rem;border-radius:6px;">
    <strong>${a.title}</strong>
    <div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px;">
      ${a.file_type.toUpperCase()} · Max: ${a.max_marks} · ${due}
    </div>
    ${a.description ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.3rem;">${a.description}</p>` : ''}
    <div style="margin-top:0.5rem;display:flex;gap:0.4rem;">
      <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="viewWeekSubmissions(${a.id})">View Submissions</button>
      <button class="btn" style="background-color:var(--danger);padding:4px 10px;font-size:11px;" onclick="deleteWeekAssignment(${a.id})">Delete</button>
    </div>
  </div>`;
}

async function createWeekAssignment(week) {
  const title = document.getElementById(`weekAsnTitle_${week}`).value.trim();
  const description = document.getElementById(`weekAsnDesc_${week}`).value;
  const fileType = document.getElementById(`weekAsnType_${week}`).value;
  const dueDate = document.getElementById(`weekAsnDue_${week}`).value;
  const maxMarks = document.getElementById(`weekAsnMarks_${week}`).value;
  if (!title) return showNotification('Please enter an assignment title', true);
  try {
    const res = await apiCall(`/api/staff/course/${currentCourseId}/assignment`, {
      method: 'POST',
      body: { week_number: week, title, description, file_type: fileType || 'any',
              due_date: dueDate || null, max_marks: parseInt(maxMarks) || 100 }
    });
    showNotification(res.message);
    await refreshWeekCourseData();
  } catch(e) {}
}

async function deleteWeekAssignment(assignmentId) {
  if (!confirm('Delete this assignment? All student submissions will be lost.')) return;
  try {
    const res = await apiCall(`/api/staff/week-assignment/${assignmentId}`, { method: 'DELETE' });
    showNotification(res.message);
    await refreshWeekCourseData();
  } catch(e) {}
}
async function viewWeekSubmissions(assignmentId) {
  currentWeekAssignmentId = assignmentId;
  try {
    const data = await apiCall(`/api/staff/week-assignment/${assignmentId}/submissions`);
    const maxMarks = data.max_marks != null ? data.max_marks : 100;
    document.getElementById('subDetailTitle').textContent = `${data.assignment_title || 'Assignment'} - Submissions`;
    document.getElementById('subDetailSummary').textContent =
      `${data.submitted} out of ${data.total} students submitted · Max Marks: ${maxMarks} · ${data.file_type || 'any'}`;
    const tbody = document.querySelector('#submissionsTable tbody');
    if (!data.submissions || data.submissions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No submissions yet.</td></tr>';
    } else {
      tbody.innerHTML = data.submissions.map(s => {
        const safeName = (s.full_name || s.username).replace(/'/g, "\\'");
        return `
        <tr>
          <td><strong>${s.username}</strong></td>
          <td>${s.full_name || '-'}</td>
          <td style="font-size:0.8rem;">${new Date(s.submitted_at).toLocaleString()}</td>
          <td><button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="previewFile('${s.file_url}','${safeName}')">Preview</button></td>
          <td style="text-align:center;">
            ${s.marks !== null && s.marks !== undefined
              ? `<span style="font-weight:700;color:${s.marks >= maxMarks/2 ? 'var(--success)' : 'var(--danger)'}">${s.marks}/${maxMarks}</span>`
              : '<span style="color:var(--text-muted);font-size:0.8rem;">Not graded</span>'}
          </td>
          <td>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <div style="display:flex;gap:4px;align-items:center;">
                <input type="number" id="gradeMarks_${s.submission_id}" class="form-control" min="0" max="${maxMarks}" step="0.5" style="width:80px;padding:3px 8px;font-size:12px;" value="${s.marks !== null && s.marks !== undefined ? s.marks : ''}">
                <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="gradeWeekSubmission(${s.submission_id},${maxMarks})">Save</button>
                ${s.marks !== null && s.marks !== undefined ? `<button class="btn btn-danger" style="padding:3px 8px;font-size:11px;" onclick="clearWeekGrade(${s.submission_id})">X</button>` : ''}
              </div>
              <input type="text" id="gradeFeedback_${s.submission_id}" class="form-control" placeholder="Feedback (optional)" style="padding:3px 8px;font-size:11px;" value="${s.feedback || ''}">
              ${s.graded_at ? `<div style="font-size:10px;color:var(--text-muted);">Graded: ${new Date(s.graded_at).toLocaleString()}</div>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('');
    }
    document.getElementById('submissionDetailPanel').classList.remove('hidden');
  } catch(e) {}
}

async function gradeWeekSubmission(submissionId, maxMarks) {
  const marks = document.getElementById(`gradeMarks_${submissionId}`).value;
  const feedback = document.getElementById(`gradeFeedback_${submissionId}`).value;
  if (!marks) return showNotification('Please enter marks', true);
  const marksNum = parseFloat(marks);
  const maxN = parseFloat(maxMarks || 100);
  if (isNaN(marksNum) || marksNum < 0 || marksNum > maxN) return showNotification(`Marks must be between 0 and ${maxN}`, true);
  try {
    const res = await apiCall(`/api/staff/week-submission/${submissionId}/grade`, {
      method: 'POST', body: { marks: marksNum, feedback: feedback || null }
    });
    showNotification(res.message);
    viewWeekSubmissions(currentWeekAssignmentId);
  } catch(e) {}
}

async function clearWeekGrade(submissionId) {
  if (!confirm('Remove this grade?')) return;
  try {
    const res = await apiCall(`/api/staff/week-submission/${submissionId}/grade`, { method: 'DELETE' });
    showNotification(res.message);
    viewWeekSubmissions(currentWeekAssignmentId);
  } catch(e) {}
}
function weekQuizFormHtml(week) {
  return `
  <form onsubmit="event.preventDefault(); createWeekQuiz(${week});">
    <div class="form-group"><label>Quiz Title</label>
      <input type="text" id="weekQuizTitle_${week}" class="form-control" placeholder="e.g. Week ${week} Quiz"></div>
    <div class="form-group"><label>Quiz Password</label>
      <input type="password" id="weekQuizPass_${week}" class="form-control" placeholder="Password students must enter to attempt"></div>
    <div class="form-group"><label>Description (Optional)</label>
      <input type="text" id="weekQuizDesc_${week}" class="form-control" placeholder="Quiz description..."></div>
    <div id="weekQuizQuestions_${week}" style="margin-bottom:0.5rem;"></div>
    <button class="btn btn-secondary" onclick="addWeekQuizQuestion(${week})" style="margin-bottom:0.5rem;">+ Add Question</button>
    <button class="btn" type="submit">Create Quiz</button>
  </form>`;
}

function weekQuizItemHtml(q) {
  return `
  <div style="background:rgba(255,255,255,0.05);padding:0.8rem;border-radius:6px;">
    <strong>${q.title}</strong>
    <div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px;">${q.question_count} questions · ${q.attempt_count} attempts</div>
    ${q.description ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-top:0.3rem;">${q.description}</p>` : ''}
    <div style="margin-top:0.5rem;display:flex;gap:0.4rem;">
      <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="viewWeekQuizResults(${q.id})">Results</button>
      <button class="btn" style="background-color:var(--danger);padding:4px 10px;font-size:11px;" onclick="deleteWeekQuiz(${q.id})">Delete</button>
    </div>
  </div>`;
}

function weekMaterialsHtml(week, materials) {
  const list = materials && materials.length > 0
    ? `<ul style="list-style:none;padding:0;margin-bottom:0.8rem;">${materials.map(m => `
        <li style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.04);padding:0.6rem;border-radius:6px;margin-bottom:0.4rem;">
          <div>
            <strong>${m.title}</strong>
            ${m.description ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">${m.description}</div>` : ''}
            <a href="${m.file_url}" target="_blank" style="font-size:0.75rem;color:var(--accent);">${m.file_url.split('/').pop()}</a>
          </div>
          <button class="btn" style="background-color:var(--danger);padding:3px 8px;font-size:10px;" onclick="deleteWeekMaterial(${m.id})">Delete</button>
        </li>`).join('')}</ul>`
    : '<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:0.8rem;">No materials for this week.</p>';

  return `
  ${list}
  <form onsubmit="event.preventDefault(); uploadWeekMaterial(${week});">
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end;">
      <div class="form-group" style="flex:1;min-width:150px;"><label>Title</label>
        <input type="text" id="weekMatTitle_${week}" class="form-control" placeholder="Material title"></div>
      <div class="form-group" style="flex:2;min-width:150px;"><label>Description (Optional)</label>
        <input type="text" id="weekMatDesc_${week}" class="form-control" placeholder="Brief description"></div>
      <div class="form-group" style="flex:1;min-width:140px;"><label>File</label>
        <input type="file" id="weekMatFile_${week}" class="form-control"></div>
      <div class="form-group"><button class="btn" type="submit">Upload</button></div>
    </div>
  </form>`;
}

async function uploadWeekMaterial(week) {
  const title = document.getElementById(`weekMatTitle_${week}`).value.trim();
  const description = document.getElementById(`weekMatDesc_${week}`).value;
  const fileInput = document.getElementById(`weekMatFile_${week}`);
  if (!title || !fileInput.files || !fileInput.files[0]) return showNotification('Please enter a title and choose a file', true);
  const fd = new FormData();
  fd.append('title', title);
  fd.append('description', description);
  fd.append('materialFile', fileInput.files[0]);
  try {
    const res = await apiCall(`/api/staff/course/${currentCourseId}/week/${week}/material`, { method: 'POST', body: fd });
    showNotification(res.message);
    await refreshWeekCourseData();
  } catch(e) {}
}

async function deleteWeekMaterial(materialId) {
  if (!confirm('Delete this material?')) return;
  try {
    const res = await apiCall(`/api/staff/week-material/${materialId}`, { method: 'DELETE' });
    showNotification(res.message);
    await refreshWeekCourseData();
  } catch(e) {}
}

function addWeekQuizQuestion(week) {
  weekQuizQuestionCount++;
  const n = weekQuizQuestionCount;
  const container = document.getElementById(`weekQuizQuestions_${week}`);
  if (!container) { weekQuizQuestionCount--; return; }
  const div = document.createElement('div');
  div.id = `week_q_${n}`;
  div.style.cssText = 'background:rgba(255,255,255,0.04);padding:0.7rem;border-radius:6px;margin-bottom:0.5rem;border:1px solid var(--card-border);';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
      <strong>Question ${n}</strong>
      <button type="button" class="btn btn-secondary" style="padding:2px 8px;font-size:10px;" onclick="removeWeekQuizQuestion(${n})">Remove</button>
    </div>
    <div class="form-group"><label>Question</label><input type="text" id="wq_text_${n}" class="form-control" placeholder="Question text"></div>
    <div class="form-group"><label>Option A</label><input type="text" id="wq_a_${n}" class="form-control"></div>
    <div class="form-group"><label>Option B</label><input type="text" id="wq_b_${n}" class="form-control"></div>
    <div class="form-group"><label>Option C</label><input type="text" id="wq_c_${n}" class="form-control"></div>
    <div class="form-group"><label>Option D</label><input type="text" id="wq_d_${n}" class="form-control"></div>
    <div class="form-group"><label>Correct Answer</label>
      <select id="wq_correct_${n}" class="form-control">
        <option value="a">A</option><option value="b">B</option><option value="c">C</option><option value="d">D</option>
      </select></div>`;
  container.appendChild(div);
}

function removeWeekQuizQuestion(n) {
  const el = document.getElementById(`week_q_${n}`);
  if (el) el.remove();
}
async function createWeekQuiz(week) {
  const title = document.getElementById(`weekQuizTitle_${week}`).value.trim();
  const description = document.getElementById(`weekQuizDesc_${week}`).value;
  const password = document.getElementById(`weekQuizPass_${week}`).value;
  if (!title) return showNotification('Please enter a quiz title', true);
  if (!password) return showNotification('Please set a quiz password (required for students)', true);
  const qDivs = document.querySelectorAll(`#weekQuizQuestions_${week} [id^="week_q_"]`);
  if (qDivs.length === 0) return showNotification('Add at least one question', true);
  const questions = [];
  qDivs.forEach(div => {
    const n = div.id.replace('week_q_', '');
    const qt = document.getElementById(`wq_text_${n}`).value;
    const qa = document.getElementById(`wq_a_${n}`).value;
    const qb = document.getElementById(`wq_b_${n}`).value;
    const qc = document.getElementById(`wq_c_${n}`).value;
    const qd = document.getElementById(`wq_d_${n}`).value;
    const correct = document.getElementById(`wq_correct_${n}`).value;
    if (qt && qa && qb && qc && qd && correct) {
      questions.push({ question_text: qt, option_a: qa, option_b: qb, option_c: qc, option_d: qd, correct_answer: correct });
    }
  });
  if (questions.length === 0) return showNotification('Please fill in all question fields', true);
  try {
    const res = await apiCall(`/api/staff/course/${currentCourseId}/quiz`, {
      method: 'POST',
      body: { week_number: week, title, description, quiz_password: password, questions }
    });
    showNotification(res.message);
    weekQuizQuestionCount = 0;
    await refreshWeekCourseData();
  } catch(e) {}
}

async function deleteWeekQuiz(quizId) {
  if (!confirm('Delete this quiz? All student attempts will be lost.')) return;
  try {
    const res = await apiCall(`/api/staff/week-quiz/${quizId}`, { method: 'DELETE' });
    showNotification(res.message);
    await refreshWeekCourseData();
  } catch(e) {}
}

async function viewWeekQuizResults(quizId) {
  try {
    const data = await apiCall(`/api/staff/week-quiz/${quizId}/results`);
    document.getElementById('staffQuizResultsTitle').textContent = data.quizTitle;
    document.getElementById('staffQuizResultsSummary').textContent =
      `${data.submitted} out of ${data.total} students attempted this quiz`;
    const tbody = document.querySelector('#staffQuizResultsTable tbody');
    if (!data.attempts || data.attempts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No attempts yet.</td></tr>';
    } else {
      tbody.innerHTML = data.attempts.map(a => `
        <tr>
          <td><strong>${a.username}</strong></td>
          <td>${a.full_name || '-'}</td>
          <td>${a.score} / ${a.total_questions}</td>
          <td style="font-size:0.8rem;">${new Date(a.submitted_at).toLocaleString()}</td>
        </tr>
      `).join('');
    }
    document.getElementById('staffQuizResultsModal').classList.remove('hidden');
  } catch(e) {}
}

async function loadStudentWeekCourses() {
  try {
    const courses = await apiCall('/api/student/courses');
    const list = document.getElementById('stuWeekCourses');
    if (!list) return;
    if (!courses || courses.length === 0) {
      list.innerHTML = '<li style="padding:0.5rem 0;color:var(--text-muted);font-size:0.85rem;">No courses are currently available.</li>';
      return;
    }
    list.innerHTML = courses.map(c => `
      <li style="margin-bottom:0.6rem;background:rgba(255,255,255,0.04);padding:0.6rem;border-radius:6px;border-left:2px solid var(--accent);">
        <strong style="color:var(--accent);cursor:pointer;" onclick="openStudentWeekCourse(${c.id})">${c.title}</strong>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">${c.class_name || 'All Classes'} · ${c.total_weeks} weeks</div>
      </li>
    `).join('');
  } catch(e) {}
}

async function openStudentWeekCourse(courseId) {
  try {
    const data = await apiCall(`/api/student/course/${courseId}`);
    // Fetch materials for this course
    try {
      data.materials = await apiCall(`/api/student/course/${courseId}/materials`);
    } catch(e) {
      data.materials = [];
    }
    currentStudentCourseId = courseId;
    document.getElementById('studentWeekCourseTitle').textContent = data.course.title;
    document.getElementById('studentWeekCourseInfo').textContent =
      `Instructor: ${data.course.staff_name || 'N/A'} · ${data.course.class_name || 'All Classes'} · ${data.course.total_weeks} weeks`;
    window.__currentStudentCourseData = data;
    renderStudentCourseWeeks(data);
    document.getElementById('studentWeekCourseModal').classList.remove('hidden');
  } catch(e) {}
}

function closeStudentWeekCourseModal() {
  const m = document.getElementById('studentWeekCourseModal');
  if (m) m.classList.add('hidden');
  currentStudentCourseId = null;
  window.__currentStudentCourseData = null;
}

function renderStudentCourseWeeks(data) {
  let html = '';
  const total = data.course.total_weeks || 0;
  const materials = data.materials || [];
  if (total <= 0) {
    html = '<p style="color:var(--text-muted);font-size:0.85rem;">No weeks configured for this course.</p>';
  } else {
    for (let week = 1; week <= total; week++) {
      const assignment = (data.assignments || []).find(a => parseInt(a.week_number) === week);
      const quiz = (data.quizzes || []).find(q => parseInt(q.week_number) === week);
      const weekMats = materials.filter(m => parseInt(m.week_number) === week);
      html += `
      <div style="margin-bottom:1.2rem;">
        <h4 style="margin-bottom:0.5rem;">Week ${week}</h4>
        ${assignment ? renderStudentAssignmentCard(assignment) : '<p style="font-size:0.8rem;color:var(--text-muted);">No assignment for this week.</p>'}
        ${quiz ? renderStudentQuizCard(quiz) : '<p style="font-size:0.8rem;color:var(--text-muted);">No quiz for this week.</p>'}
        ${weekMats.length > 0 ? renderStudentMaterials(weekMats) : ''}
      </div>`;
    }
  }
  document.getElementById('studentWeekCourseContent').innerHTML = html;
}

function renderStudentAssignmentCard(a) {
  const due = a.due_date ? new Date(a.due_date).toLocaleString() : 'No deadline';
  let card = `
  <div style="background:rgba(255,255,255,0.04);padding:0.7rem;border-radius:6px;margin:0.4rem 0;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div><strong>${a.title}</strong>
        <div style="font-size:0.78rem;color:var(--text-muted);">${a.file_type.toUpperCase()} · Max Marks: ${a.max_marks} · Due: ${due}</div>`;
  if (a.description) card += `<p style="font-size:0.78rem;color:var(--text-muted);margin-top:0.3rem;">${a.description}</p>`;
  card += `</div>`;
  if (a.has_submitted > 0) {
    let gradeInfo = '';
    if (a.my_marks !== null && a.my_marks !== undefined) {
      gradeInfo = `<div style="font-size:0.8rem;font-weight:600;color:${a.my_marks >= a.max_marks/2 ? 'var(--success)' : 'var(--danger)'}">Score: ${a.my_marks}/${a.max_marks}</div>`;
      if (a.my_feedback) gradeInfo += `<div style="font-size:0.72rem;color:var(--text-muted);">${a.my_feedback}</div>`;
    } else {
      gradeInfo = `<div style="font-size:0.72rem;color:var(--text-muted);">Awaiting grading</div>`;
    }
    card += `<div style="text-align:right;">${gradeInfo}<button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="previewFile('${a.my_file_url}','${a.title}')">View Submission</button></div>`;
  } else {
    card += `
    <div style="display:flex;gap:0.4rem;align-items:flex-end;">
      <div style="flex:1;"><input type="file" id="weekUploadFile_${a.id}" accept=".pdf,.csv,.mp4,.doc,.docx,.xls,.xlsx,.txt,.zip,.ppt,.pptx" style="font-size:0.8rem;width:100%;"></div>
      <button class="btn" style="padding:4px 10px;font-size:11px;" onclick="submitStudentWeekAssignment(${a.id})">Submit</button>
    </div>`;
  }
  card += `</div></div>`;
  return card;
}

async function submitStudentWeekAssignment(assignmentId) {
  const input = document.getElementById(`weekUploadFile_${assignmentId}`);
  if (!input || !input.files || !input.files[0]) return showNotification('Please choose a file first', true);
  const formData = new FormData();
  formData.append('assignment_id', assignmentId);
  formData.append('assignmentFile', input.files[0]);
  try {
    const res = await apiCall('/api/student/submit-week-assignment', { method: 'POST', body: formData });
    showNotification(res.message);
    input.value = '';
    if (currentStudentCourseId) openStudentWeekCourse(currentStudentCourseId);
  } catch(e) {}
}

function renderStudentQuizCard(q) {
  let btn, status = '';
  if (q.has_attempted > 0) {
    btn = `<button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="viewWeekQuizResult(${q.id})">View Result</button>`;
    status = ` · <span style="color:var(--success);font-size:0.78rem;">Attempted</span>`;
  } else {
    btn = `<button class="btn" style="padding:4px 10px;font-size:11px;" onclick="startWeekQuiz(${q.id})">Start Quiz</button>`;
  }
  const desc = q.description ? `<p style="font-size:0.78rem;color:var(--text-muted);margin:0.25rem 0;">${q.description}</p>` : '';
  return `
  <div style="background:rgba(255,255,255,0.04);padding:0.6rem;border-radius:6px;margin:0.4rem 0 0;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div><strong>${q.title}</strong> ${desc}<div style="font-size:0.78rem;color:var(--text-muted);">${q.question_count} questions${status}</div></div>
      ${btn}
    </div>
  </div>`;
}

function renderStudentMaterials(materials) {
  const items = materials.map(m => `
    <li style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.03);padding:0.5rem 0.6rem;border-radius:6px;margin-bottom:0.3rem;">
      <div>
        <strong style="font-size:0.85rem;">${m.title}</strong>
        ${m.description ? `<div style="font-size:0.75rem;color:var(--text-muted);">${m.description}</div>` : ''}
      </div>
      <a href="${m.file_url}" target="_blank" class="btn btn-secondary" style="padding:3px 10px;font-size:11px;white-space:nowrap;">View</a>
    </li>`).join('');
  return `<div style="margin-top:0.5rem;">
    <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.3rem;font-weight:600;">Materials</div>
    <ul style="list-style:none;padding:0;">${items}</ul>
  </div>`;
}

function startWeekQuiz(quizId) {
  quizPasswordMode = 'week';
  currentWeekQuizId = quizId;
  document.getElementById('weekQuizPassword').value = '';
  document.getElementById('weekQuizPasswordDesc').textContent = 'Enter the password set by your instructor to unlock the quiz.';
  document.getElementById('weekQuizPasswordModal').classList.remove('hidden');
}

async function verifyWeekQuizPassword() {
  const password = document.getElementById('weekQuizPassword').value;
  if (!password) return showNotification('Please enter the quiz password', true);

  const isNormal = quizPasswordMode === 'normal';
  const quizId = isNormal ? currentQuizId : currentWeekQuizId;
  if (!quizId) return;

  try {
    const endpoint = isNormal
      ? `/api/student/quiz/${quizId}/start`
      : `/api/student/week-quiz/${quizId}/start`;
    const data = await apiCall(endpoint, { method: 'POST', body: { password } });

    if (isNormal) {
      quizMode = 'regular';
    } else {
      quizMode = 'weekQuiz';
    }
    document.getElementById('quizAttemptTitle').textContent = data.quiz.title;
    document.getElementById('quizAttemptDesc').textContent = data.quiz.description || 'Answer all the questions below';
    document.getElementById('quizAttemptQuestions').innerHTML = buildQuizQuestionsHtml(data.questions);
    document.getElementById('weekQuizPasswordModal').classList.add('hidden');
    document.getElementById('quizAttemptModal').classList.remove('hidden');
  } catch(e) {
    if (e.message) showNotification(e.message, true);
  }
}

async function submitWeekQuizAttempt() {
  if (!currentWeekQuizId) return;
  const questions = document.querySelectorAll('#quizAttemptQuestions > div');
  const answers = {};
  let allAnswered = true;
  questions.forEach(div => {
    const radioName = div.querySelector('input[type="radio"]')?.name;
    if (radioName) {
      const selected = document.querySelector(`input[name="${radioName}"]:checked`);
      const qId = radioName.replace('q_', '');
      if (selected) { answers[qId] = selected.value; } else { allAnswered = false; }
    }
  });
  if (!allAnswered) {
    if (!confirm('You have not answered all questions. Submit anyway?')) return;
  }
  try {
    const res = await apiCall(`/api/student/week-quiz/${currentWeekQuizId}/submit`, {
      method: 'POST', body: { answers }
    });
    closeQuizAttemptModal();
    showNotification(`Quiz submitted! Score: ${res.score}/${res.total}`);
    loadStudentWeekCourses();
    if (currentStudentCourseId) openStudentWeekCourse(currentStudentCourseId);
  } catch(e) {}
}

async function viewWeekQuizResult(quizId) {
  try {
    const data = await apiCall(`/api/student/week-quiz/${quizId}/result`);
    document.getElementById('quizResultTitle').textContent = data.title;
    document.getElementById('quizResultScore').textContent = `${data.score}/${data.total_questions}`;
    document.getElementById('quizResultScore').style.color = data.score >= data.total_questions/2 ? 'var(--success)' : 'var(--danger)';
    document.getElementById('quizResultDetails').textContent = `Submitted on ${new Date(data.submitted_at).toLocaleString()}`;
    const answersDiv = document.getElementById('quizResultAnswers');
    if (data.answers && data.answers.length > 0) {
      answersDiv.innerHTML = '<h4 style="margin-bottom:0.5rem;">Question Details</h4>' + data.answers.map((a, idx) => `
        <div style="padding:0.5rem;margin-bottom:0.3rem;border-radius:4px;background:${a.isCorrect ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'};border-left:3px solid ${a.isCorrect ? 'var(--success)' : 'var(--danger)'}">
          <strong>Q${idx + 1}:</strong> Your answer: ${a.studentAnswer || '(not answered)'}
          ${!a.isCorrect ? `<span style="color:var(--success);"> · Correct: ${a.correctAnswer}</span>` : ''}
        </div>
      `).join('');
    } else {
      answersDiv.innerHTML = '';
    }
    document.getElementById('quizResultModal').classList.remove('hidden');
  } catch(e) {}
}

function closeWeekQuizPasswordModal() {
  document.getElementById('weekQuizPasswordModal').classList.add('hidden');
  document.getElementById('weekQuizPassword').value = '';
  quizPasswordMode = null;
  currentWeekQuizId = null;
  currentQuizId = null;
  quizMode = 'regular';
}

// ====================================================
// Leave Management (Student)
// ====================================================
async function applyLeave() {
  const leaveType = document.getElementById('leaveType').value;
  const reason = document.getElementById('leaveReason').value.trim();
  if (!reason) return showNotification('Please enter a reason for leave', true);
  try {
    const res = await apiCall('/api/student/leave/apply', {
      method: 'POST', body: { leave_type: leaveType, reason }
    });
    showNotification(res.message);
    document.getElementById('leaveReason').value = '';
    loadStudentLeaves();
  } catch(e) {}
}

async function loadStudentLeaves() {
  const list = document.getElementById('stuLeaveList');
  if (!list) return;
  try {
    const leaves = await apiCall('/api/student/leaves');
    if (!leaves || leaves.length === 0) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No leave applications yet.</p>';
      return;
    }
    list.innerHTML = leaves.map(l => {
      let statusColor;
      if (l.status === 'approved') statusColor = 'var(--success)';
      else if (l.status === 'rejected') statusColor = 'var(--danger)';
      else statusColor = 'var(--accent)';
      return `
      <li style="background:rgba(255,255,255,0.04);padding:0.7rem;border-radius:6px;margin-bottom:0.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
          <div>
            <strong style="text-transform:capitalize;">${l.leave_type}</strong> Leave
            <span class="badge" style="background:${statusColor};color:white;margin-left:0.5rem;font-size:0.7rem;">${l.status.toUpperCase()}</span>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px;">${l.reason}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;">Applied: ${new Date(l.applied_at).toLocaleString()}</div>
            ${l.review_remarks ? `<div style="font-size:0.78rem;margin-top:3px;">Mentor's note: <em>${l.review_remarks}</em></div>` : ''}
          </div>
        </div>
      </li>`;
    }).join('');
  } catch(e) {}
}

async function loadStudentMentor() {
  let mentorInfo = null;
  try {
    const res = await apiCall('/api/student/class-mentor');
    mentorInfo = res.mentor;
    const el = document.getElementById('dispStuMentor');
    if (res.mentor) {
      el.innerHTML = `${res.mentor.full_name || res.mentor.username} (${res.mentor.username})`;
    } else {
      el.textContent = 'Not assigned';
    }
  } catch(e) {
    const el = document.getElementById('dispStuMentor');
    if (el) el.textContent = 'Not assigned';
  }
  // Also fill the visible mentor chip in the Leave panel
  const chip = document.getElementById('leaveMentorChip');
  if (chip) {
    chip.textContent = mentorInfo ? `Mentor: ${mentorInfo.full_name || mentorInfo.username}` : 'Mentor: Not assigned';
    chip.style.background = mentorInfo ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.08)';
    chip.style.color = mentorInfo ? 'var(--success)' : 'var(--text-muted)';
  }
}

// ====================================================
// Leave Management (Staff — mentor of a class)
// ====================================================
async function loadStaffLeaves() {
  const list = document.getElementById('staffLeaveList');
  const empty = document.getElementById('staffLeavesEmpty');
  if (!list) return;
  try {
    const leaves = await apiCall('/api/staff/leaves');
    if (!leaves || leaves.length === 0) {
      list.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    list.innerHTML = leaves.map(l => {
      let statusBadge, actions = '';
      if (l.status === 'pending') {
        statusBadge = '<span class="badge" style="background:var(--accent);color:white;font-size:0.7rem;">PENDING</span>';
        actions = `
        <div style="display:flex;gap:0.4rem;margin-top:0.4rem;">
          <button class="btn" style="background-color:var(--success);padding:3px 10px;font-size:11px;" onclick="approveLeave(${l.id})">Approve</button>
          <button class="btn" style="background-color:var(--danger);padding:3px 10px;font-size:11px;" onclick="rejectLeave(${l.id})">Reject</button>
        </div>`;
      } else if (l.status === 'approved') {
        statusBadge = '<span class="badge" style="background:var(--success);color:white;font-size:0.7rem;">APPROVED</span>';
      } else {
        statusBadge = '<span class="badge" style="background:var(--danger);color:white;font-size:0.7rem;">REJECTED</span>';
      }
      return `
      <li style="background:rgba(255,255,255,0.04);padding:0.8rem;border-radius:6px;margin-bottom:0.6rem;border-left:3px solid var(--card-border);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
          <div>
            <strong>${l.student_name || l.student_username}</strong> (${l.student_username})
            ${statusBadge}
            <div style="font-size:0.85rem;margin-top:4px;text-transform:capitalize;"><strong>${l.leave_type}</strong> Leave</div>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px;">Reason: ${l.reason}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;">Applied: ${new Date(l.applied_at).toLocaleString()}</div>
            ${l.review_remarks ? `<div style="font-size:0.78rem;margin-top:3px;">Note: <em>${l.review_remarks}</em></div>` : ''}
          </div>
          ${actions}
        </div>
      </li>`;
    }).join('');
  } catch(e) {}
}

async function approveLeave(leaveId) {
  const remarks = prompt('Review remarks (optional):') || '';
  try {
    const res = await apiCall(`/api/staff/leave/${leaveId}/approve`, {
      method: 'PUT', body: { review_remarks: remarks || null }
    });
    showNotification(res.message);
    loadStaffLeaves();
  } catch(e) {}
}

async function rejectLeave(leaveId) {
  const remarks = prompt('Reason for rejection (optional):') || '';
  try {
    const res = await apiCall(`/api/staff/leave/${leaveId}/reject`, {
      method: 'PUT', body: { review_remarks: remarks || null }
    });
    showNotification(res.message);
    loadStaffLeaves();
  } catch(e) {}
}

// ====================================================
// Mentor Assignment (Admin)
// ====================================================
async function loadMentorAssignment() {
  const classSelect = document.getElementById('mentorClassSelect');
  const staffSelect = document.getElementById('mentorStaffSelect');
  if (!classSelect || !staffSelect) return;
  try {
    const classes = await apiCall('/api/classes');
    classSelect.innerHTML = '<option value="">-- Select class --</option>' + classes.map(c =>
      `<option value="${c.id}">${c.name}${c.mentor_name ? ` (Mentor: ${c.mentor_name})` : ''}</option>`
    ).join('');
    classSelect.onchange = () => {
      const sel = classes.find(c => c.id == classSelect.value);
      const disp = document.getElementById('currentMentorDisplay');
      disp.innerHTML = sel && sel.mentor_name
        ? `Current Mentor: <strong>${sel.mentor_name}</strong> (${sel.mentor_username})`
        : 'No mentor assigned to this class.';
    };
  } catch(e) {}

  try {
    const allStaff = await apiCall('/api/all-staff');
    staffSelect.innerHTML = '<option value="">-- Select staff --</option>' + allStaff.map(s =>
      `<option value="${s.id}">${s.full_name || s.username} (${s.username})</option>`
    ).join('');
  } catch(e) {}
}

async function assignMentor() {
  const classId = document.getElementById('mentorClassSelect').value;
  const mentorId = document.getElementById('mentorStaffSelect').value;
  if (!classId || !mentorId) return showNotification('Select both a class and a staff member', true);
  try {
    const res = await apiCall(`/api/admin/class/${classId}/mentor`, {
      method: 'PUT', body: { mentor_id: mentorId }
    });
    showNotification(res.message);
    loadMentorAssignment();
  } catch(e) {}
}

async function removeMentor() {
  const classId = document.getElementById('mentorClassSelect').value;
  if (!classId) return showNotification('Select a class first', true);
  if (!confirm('Remove the mentor from this class?')) return;
  try {
    const res = await apiCall(`/api/admin/class/${classId}/mentor`, { method: 'DELETE' });
    showNotification(res.message);
    loadMentorAssignment();
  } catch(e) {}
}

// ===================================================
// Student Topics (Week Courses as topic cards)
// ===================================================
async function loadStudentTopics() {
    const container = document.getElementById('stuTopicsContainer');
    if (!container) return;
    try {
        // Use the same endpoint as the Week Courses list
        const courses = await apiCall('/api/student/courses');
        if (!courses || courses.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No topics available yet.</p>';
            return;
        }
        container.innerHTML = courses.map(c => {
            const weeks = parseInt(c.total_weeks) || 0;
            return `
            <div class="topic-card" onclick="openStudentWeekCourse(${c.id})" style="flex:1;min-width:140px;background:rgba(255,255,255,0.06);border:1px solid var(--card-border);border-radius:12px;padding:14px;cursor:pointer;">
                <div style="font-size:14px;font-weight:600;margin-bottom:4px;">${c.title}</div>
                <div style="font-size:12px;color:#888;">${weeks} week${weeks != 1 ? 's' : ''}</div>
            </div>`;
        }).join('');
    } catch(e) {
        container.innerHTML = '<p style="color:#ef4444;font-size:0.85rem;">Failed to load topics.</p>';
    }
}

// ===================================================
// Mobile Logo Swap — show sjc_logo_nobg.png on mobile only
// ===================================================
function swapMobileLogos() {
    const isMobile = window.innerWidth <= 768;
    const SJC = './uploads/sjc_logo_nobg.png';
    const topRightLogo = document.getElementById('topRightLogo');
    const brandLogo = document.getElementById('brandLogo');
    if (topRightLogo) {
        topRightLogo.src = SJC; // same on both, kept in sync
    }
    if (brandLogo) {
        brandLogo.src = isMobile ? SJC : './lll.png';
    }
}

// Also swap on window resize
window.addEventListener('resize', swapMobileLogos);

// ===================================================
// Mobile FAB Navigation (role-aware)
// ===================================================
function initMobileFab(role) {
    let fabNav = document.querySelector('.mobile-fab-nav');
    if (!fabNav) {
        fabNav = document.createElement('div');
        fabNav.className = 'mobile-fab-nav';
        document.body.appendChild(fabNav);
    }

    if (role === 'student') {
        fabNav.style.display = ''; // let CSS media query control visibility
        fabNav.innerHTML = `
        <button class="fab-btn fab-active" onclick="window.scrollTo({top:0,behavior:'smooth'})" title="Top"><span class="material-icons" style="font-size:22px;">dashboard</span></button>
        <button class="fab-btn" onclick="scrollToSection('stuWeekCourses')" title="Week Courses"><span class="material-icons" style="font-size:22px;">menu_book</span></button>
        <button class="fab-btn" onclick="scrollToSection('stuMaterials')" title="Materials"><span class="material-icons" style="font-size:22px;">search</span></button>
        <button class="fab-btn" onclick="scrollToSection('stuQuizList')" title="Quizzes"><span class="material-icons" style="font-size:22px;">quiz</span></button>
        <button class="fab-btn" onclick="scrollToSection('stuLeaveList')" title="Leave"><span class="material-icons" style="font-size:22px;">event_busy</span></button>
    `;
    } else if (role === 'staff') {
        fabNav.style.display = '';
        fabNav.innerHTML = `
        <button class="fab-btn fab-active" onclick="staffFabGo('profile', this)" title="My Profile"><span class="material-icons" style="font-size:22px;">person</span></button>
        <button class="fab-btn" onclick="staffFabGo('weekCourses', this)" title="Week Courses"><span class="material-icons" style="font-size:22px;">menu_book</span></button>
        <button class="fab-btn" onclick="staffFabGo('leaves', this)" title="Leaves"><span class="material-icons" style="font-size:22px;">event_busy</span></button>
        <button class="fab-btn" onclick="staffFabGo('inbox', this)" title="Inbox"><span class="material-icons" style="font-size:22px;">mail</span></button>
        <button class="fab-btn" onclick="staffFabGo('attendance', this)" title="Attendance"><span class="material-icons" style="font-size:22px;">fact_check</span></button>
    `;
    } else {
        // Admin or unknown role: hide the FAB
        fabNav.style.display = 'none';
        fabNav.innerHTML = '';
    }
}

// Staff FAB: switch the staff feature panel and scroll to it
function staffFabGo(featureName, btn) {
    showStaffFeature(featureName, btn);
    document.querySelectorAll('.fab-btn').forEach(b => b.classList.remove('fab-active'));
    if (btn) btn.classList.add('fab-active');
    const panel = document.getElementById('staffFeature' + featureName.charAt(0).toUpperCase() + featureName.slice(1));
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollToSection(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

window.onload = checkSession;


